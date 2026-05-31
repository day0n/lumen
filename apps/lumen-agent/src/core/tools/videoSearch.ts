/**
 * search_ad_videos —— 通过 Foreplay 广告库检索参考短视频。
 *
 * 当前实现只对接 Foreplay 的 discovery API（直连 HTTP），返回其自带的视频地址，
 * 不经过对象存储中转。命中过多时用一个轻量 LLM 做相关性排序裁剪。
 */

import OpenAI from 'openai';

import { type JsonSchema, Tool } from '../../core/tools/base.js';
import { logger } from '../../observability/logger.js';
import type { ToolResult } from '../../schemas/tools.js';

interface AdRef {
  source: string;
  pageUrl: string;
  mediaUrl?: string;
  caption: string;
  advertiser: string;
  viewCount: number | null;
  likeCount: number | null;
  lengthSec: number | null;
  thumbUrl: string;
  sponsored: boolean;
  liveDays: number | null;
  clickRate: number | null;
  layout: string;
}

function humanCount(n: number | null): string {
  if (n == null) return '?';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function isLongRunning(d: number | null): boolean {
  return d != null && d >= 10;
}

async function searchForeplay(
  query: string,
  apiKey: string,
  baseUrl: string,
  limit: number,
): Promise<AdRef[]> {
  if (!apiKey) {
    logger.warn('FOREPLAY_API_KEY 未配置，跳过 Foreplay');
    return [];
  }
  try {
    const url = new URL(`${baseUrl.replace(/\/$/, '')}/api/discovery/ads`);
    url.searchParams.set('query', query);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('display_format', 'video');
    url.searchParams.set('order', 'most_relevant');

    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Foreplay 返回非 200');
      return [];
    }
    const json = (await res.json()) as { data?: Array<Record<string, unknown>> };
    const items = json.data ?? [];

    const out: AdRef[] = [];
    for (const item of items.slice(0, limit)) {
      const platforms = (item.publisher_platform as unknown[]) ?? [];
      const platformStr = Array.isArray(platforms) ? platforms.join(', ') : String(platforms);
      const caption = (item.description ?? item.cta_title ?? item.name ?? '') as string;
      const running = (item.running_duration ?? {}) as { days?: number };
      out.push({
        source: `Foreplay (${platformStr || 'unknown'})`,
        pageUrl: (item.link_url as string) || (item.video as string) || '',
        mediaUrl: (item.video as string) || '',
        caption: caption.slice(0, 200),
        advertiser: (item.name as string) ?? '',
        viewCount: null,
        likeCount: null,
        lengthSec: item.video_duration ? Number(item.video_duration) : null,
        thumbUrl: ((item.thumbnail as string) || (item.avatar as string) || '') as string,
        sponsored: true,
        liveDays: typeof running?.days === 'number' ? running.days : null,
        clickRate: null,
        layout: (item.display_format as string) ?? '',
      });
    }
    return out;
  } catch (err) {
    logger.error({ err }, 'Foreplay search failed');
    return [];
  }
}

function refIdentity(c: AdRef): string {
  if (c.mediaUrl) return `m:${c.mediaUrl.toLowerCase()}`;
  if (c.thumbUrl) return `t:${c.thumbUrl.toLowerCase()}`;
  if (c.pageUrl) return `p:${c.pageUrl.toLowerCase()}`;
  return [c.source, c.advertiser, c.caption, c.lengthSec ?? ''].join('|').toLowerCase();
}

function dropDuplicates(refs: AdRef[]): AdRef[] {
  const seen = new Set<string>();
  const out: AdRef[] = [];
  for (const c of refs) {
    const k = refIdentity(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

function renderRefLine(c: AdRef, label: string): string {
  const parts: string[] = [label];
  if (c.advertiser) parts.push(`@${c.advertiser}`);
  if (c.viewCount != null) parts.push(`${humanCount(c.viewCount)} plays`);
  if (c.likeCount != null) parts.push(`${humanCount(c.likeCount)} likes`);
  if (isLongRunning(c.liveDays)) parts.push(`running ${c.liveDays}d`);
  if (c.clickRate != null) parts.push(`CTR ${c.clickRate}`);
  return parts.join(' | ');
}

function rankByEngagement(refs: AdRef[]): number[] {
  const scored = refs.map((c, i) => {
    let s = (c.viewCount ?? 0) + (c.likeCount ?? 0) * 10;
    if (c.liveDays) s += c.liveDays * 1000;
    return [s, i] as const;
  });
  scored.sort((a, b) => b[0] - a[0]);
  return scored.map(([, i]) => i);
}

async function rankWithLLM(
  query: string,
  refs: AdRef[],
  openai: OpenAI,
  want: number,
): Promise<{ indices: number[]; costUsd: number }> {
  if (refs.length <= want) {
    return { indices: refs.map((_, i) => i), costUsd: 0 };
  }
  const catalog = refs
    .map((c, i) => {
      const head = renderRefLine(c, `#${i + 1} [${c.source}]`);
      const snippet = (c.caption ?? '').slice(0, 100);
      return snippet ? `${head} | "${snippet}"` : head;
    })
    .join('\n');

  const instruction = [
    `Reference query: "${query}"`,
    '',
    `Below are ${refs.length} ad-creative candidates pulled from the Foreplay library.`,
    `Select the ${want} that best match the query for creative reference. Favour candidates that are`,
    'on-topic, show strong engagement, and have run for many days (a sign of proven performance).',
    '',
    'Candidates:',
    catalog,
    '',
    'Respond with ONLY a JSON array of the chosen 1-based indices ordered best-first,',
    'e.g. [3, 1, 7, 5, 2].',
  ].join('\n');

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: instruction }],
      temperature: 0,
      max_tokens: 200,
    });
    const usage = resp.usage;
    let costUsd = 0;
    if (usage) {
      costUsd =
        (usage.prompt_tokens * 0.15) / 1_000_000 + (usage.completion_tokens * 0.6) / 1_000_000;
    }
    const raw = resp.choices[0]?.message.content?.trim() ?? '[]';
    const cleaned = raw
      .replace(/^```(?:json)?/, '')
      .replace(/```$/, '')
      .trim();
    const picked = JSON.parse(cleaned) as number[];
    if (Array.isArray(picked)) {
      return {
        indices: picked
          .map((x) => Number(x) - 1)
          .filter((i) => i >= 0 && i < refs.length)
          .slice(0, want),
        costUsd,
      };
    }
  } catch (err) {
    logger.warn({ err }, 'LLM ranking failed; falling back to engagement score');
  }

  return { indices: rankByEngagement(refs).slice(0, want), costUsd: 0 };
}

export class VideoSearchTool extends Tool {
  override readonly name = 'search_ad_videos';
  override readonly timeoutSeconds = 60;
  override readonly description =
    'Search for trending and popular videos across TikTok, Instagram, and ad databases (Foreplay). ' +
    'Searches all platforms in parallel and uses AI to pick the requested number of relevant results. ' +
    'Use this when the user wants to find reference videos, ad creatives, or viral content for ' +
    'a given topic or keyword. ' +
    'IMPORTANT: The query MUST be in English. If the user request is in another language, translate ' +
    "the search keywords to English before calling this tool. Use ONLY core keywords; don't add adjectives.";

  override readonly parameters: JsonSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Search keyword. MUST be in English. Use only core keywords, no adjectives.',
      },
      count: {
        type: 'integer',
        description: 'Number of videos to return. Defaults to 1. Use 2-3 only if more refs needed.',
        minimum: 1,
        maximum: 10,
        default: 1,
      },
    },
    required: ['query'],
  };

  private openai: OpenAI | null = null;

  constructor(
    private readonly opts: {
      foreplayApiKey?: string;
      foreplayBaseUrl?: string;
      openaiApiKey?: string;
    } = {},
  ) {
    super();
  }

  private getOpenAI(): OpenAI | null {
    if (!this.opts.openaiApiKey) return null;
    if (!this.openai) this.openai = new OpenAI({ apiKey: this.opts.openaiApiKey });
    return this.openai;
  }

  override async execute(args: Record<string, unknown>): Promise<string | ToolResult> {
    const query = String(args.query);
    const count = Math.max(1, Math.min(10, (args.count as number) ?? 1));
    const searchLimit = Math.max(count * 4, 10);

    const foreplay = await searchForeplay(
      query,
      this.opts.foreplayApiKey ?? '',
      this.opts.foreplayBaseUrl ?? 'https://public.api.foreplay.co',
      searchLimit,
    );

    const refs = dropDuplicates(foreplay);
    if (refs.length === 0) return `No videos found for: ${query}`;

    const openai = this.getOpenAI();
    let selected: AdRef[];
    let costUsd = 0;
    if (openai) {
      const { indices, costUsd: c } = await rankWithLLM(query, refs, openai, count);
      costUsd = c;
      selected = indices.map((i) => refs[i]!).slice(0, count);
    } else {
      selected = refs.slice(0, count);
    }
    if (selected.length === 0) return `No videos found for: ${query}`;

    const lines: string[] = [`Found ${selected.length} videos for "${query}":`, ''];
    selected.forEach((v, i) => {
      const parts: string[] = [`[${v.source}]`];
      if (v.advertiser) parts.push(`@${v.advertiser}`);
      if (v.viewCount != null) parts.push(`${humanCount(v.viewCount)} plays`);
      if (v.likeCount != null) parts.push(`${humanCount(v.likeCount)} likes`);
      if (v.lengthSec) parts.push(`${v.lengthSec}s`);
      if (isLongRunning(v.liveDays)) parts.push(`running ${v.liveDays}d`);
      lines.push(`${i + 1}. ${parts.join(' | ')}`);
      if (v.caption) lines.push(`   "${v.caption}"`);
      if (v.mediaUrl) lines.push(`   Video: ${v.mediaUrl}`);
      if (v.pageUrl) lines.push(`   Source: ${v.pageUrl}`);
      lines.push('');
    });

    return {
      content: lines.join('\n'),
      events: [],
      interrupt: false,
      cost_usd: costUsd > 0 ? costUsd : null,
      hide_tools: [],
      unhide_tools: [],
    } satisfies ToolResult;
  }
}
