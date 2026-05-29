/**
 * video_search —— Foreplay 路径。
 *
 * 简化：第一阶段只接 Foreplay（直接 HTTP），不接 TikTok/Instagram（需要 Apify）。
 * 不做下载到 COS（lumen 还没接 TOS），直接返回 Foreplay 自带的 video URL。
 * 候选筛选用 OpenAI gpt-4o-mini（与原版一致）。
 */

import OpenAI from 'openai';

import { type JsonSchema, Tool } from '../../core/tools/base.js';
import { logger } from '../../observability/logger.js';
import type { ToolResult } from '../../schemas/tools.js';

interface VideoCandidate {
  platform: string;
  url: string;
  video_file_url?: string;
  description: string;
  author: string;
  plays: number | null;
  likes: number | null;
  duration_sec: number | null;
  cover_url: string;
  is_ad: boolean;
  running_days: number | null;
  ctr: number | null;
  format: string;
}

function fmtCount(n: number | null): string {
  if (n == null) return '?';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function showRunningDays(d: number | null): boolean {
  return d != null && d >= 10;
}

async function searchForeplay(
  query: string,
  apiKey: string,
  baseUrl: string,
  limit: number,
): Promise<VideoCandidate[]> {
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

    const out: VideoCandidate[] = [];
    for (const item of items.slice(0, limit)) {
      const platforms = (item.publisher_platform as unknown[]) ?? [];
      const platformStr = Array.isArray(platforms) ? platforms.join(', ') : String(platforms);
      const desc = (item.description ?? item.cta_title ?? item.name ?? '') as string;
      const running = (item.running_duration ?? {}) as { days?: number };
      out.push({
        platform: `Foreplay (${platformStr || 'unknown'})`,
        url: (item.link_url as string) || (item.video as string) || '',
        video_file_url: (item.video as string) || '',
        description: desc.slice(0, 200),
        author: (item.name as string) ?? '',
        plays: null,
        likes: null,
        duration_sec: item.video_duration ? Number(item.video_duration) : null,
        cover_url: ((item.thumbnail as string) || (item.avatar as string) || '') as string,
        is_ad: true,
        running_days: typeof running?.days === 'number' ? running.days : null,
        ctr: null,
        format: (item.display_format as string) ?? '',
      });
    }
    return out;
  } catch (err) {
    logger.error({ err }, 'Foreplay search failed');
    return [];
  }
}

function dedupeKey(c: VideoCandidate): string {
  if (c.video_file_url) return `vf:${c.video_file_url.toLowerCase()}`;
  if (c.cover_url) return `cv:${c.cover_url.toLowerCase()}`;
  if (c.url) return `u:${c.url.toLowerCase()}`;
  return [c.platform, c.author, c.description, c.duration_sec ?? ''].join('|').toLowerCase();
}

function dedupe(cands: VideoCandidate[]): VideoCandidate[] {
  const seen = new Set<string>();
  const out: VideoCandidate[] = [];
  for (const c of cands) {
    const k = dedupeKey(c);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(c);
  }
  return out;
}

function buildSummary(cands: VideoCandidate[]): string {
  return cands
    .map((c, i) => {
      const parts: string[] = [`#${i + 1} [${c.platform}]`];
      if (c.author) parts.push(`@${c.author}`);
      if (c.plays != null) parts.push(`${fmtCount(c.plays)} plays`);
      if (c.likes != null) parts.push(`${fmtCount(c.likes)} likes`);
      if (showRunningDays(c.running_days)) parts.push(`running ${c.running_days}d`);
      if (c.ctr != null) parts.push(`CTR ${c.ctr}`);
      const desc = (c.description ?? '').slice(0, 100);
      if (desc) parts.push(`"${desc}"`);
      return parts.join(' | ');
    })
    .join('\n');
}

async function filterWithLLM(
  query: string,
  cands: VideoCandidate[],
  openai: OpenAI,
  maxResults: number,
): Promise<{ indices: number[]; costUsd: number }> {
  if (cands.length <= maxResults) {
    return { indices: cands.map((_, i) => i), costUsd: 0 };
  }
  const summary = buildSummary(cands);
  const prompt = `User is searching for video references related to: "${query}"\n\nBelow are ${cands.length} candidate videos from TikTok, Instagram, and Foreplay (ad database).\nPick the ${maxResults} most relevant ones for the user's creative needs. Prefer videos that are: highly relevant to the query, have high engagement, and include Foreplay ads with long running days (proven effective ads).\n\nCandidates:\n${summary}\n\nReturn ONLY a JSON array of the selected candidate numbers (1-indexed), ordered by relevance. Example: [3, 1, 7, 5, 2, 8, 4, 6, 9, 10]`;

  try {
    const resp = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
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
    const indices = JSON.parse(cleaned) as number[];
    if (Array.isArray(indices)) {
      return {
        indices: indices
          .map((x) => Number(x) - 1)
          .filter((i) => i >= 0 && i < cands.length)
          .slice(0, maxResults),
        costUsd,
      };
    }
  } catch (err) {
    logger.warn({ err }, 'LLM filtering failed; falling back to engagement score');
  }

  // 兜底：按 plays + likes*10 + running_days*1000 排序
  const scored = cands.map((c, i) => {
    let s = (c.plays ?? 0) + (c.likes ?? 0) * 10;
    if (c.running_days) s += c.running_days * 1000;
    return [s, i] as const;
  });
  scored.sort((a, b) => b[0] - a[0]);
  return { indices: scored.slice(0, maxResults).map(([, i]) => i), costUsd: 0 };
}

export class VideoSearchTool extends Tool {
  override readonly name = 'video_search';
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

    const candidates = dedupe(foreplay);
    if (candidates.length === 0) return `No videos found for: ${query}`;

    const openai = this.getOpenAI();
    let selected: VideoCandidate[];
    let costUsd = 0;
    if (openai) {
      const { indices, costUsd: c } = await filterWithLLM(query, candidates, openai, count);
      costUsd = c;
      selected = indices.map((i) => candidates[i]!).slice(0, count);
    } else {
      selected = candidates.slice(0, count);
    }
    if (selected.length === 0) return `No videos found for: ${query}`;

    const lines: string[] = [`Found ${selected.length} videos for "${query}":`, ''];
    selected.forEach((v, i) => {
      const parts: string[] = [`[${v.platform}]`];
      if (v.author) parts.push(`@${v.author}`);
      if (v.plays != null) parts.push(`${fmtCount(v.plays)} plays`);
      if (v.likes != null) parts.push(`${fmtCount(v.likes)} likes`);
      if (v.duration_sec) parts.push(`${v.duration_sec}s`);
      if (showRunningDays(v.running_days)) parts.push(`running ${v.running_days}d`);
      lines.push(`${i + 1}. ${parts.join(' | ')}`);
      if (v.description) lines.push(`   "${v.description}"`);
      if (v.video_file_url) lines.push(`   Video: ${v.video_file_url}`);
      if (v.url) lines.push(`   Source: ${v.url}`);
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
