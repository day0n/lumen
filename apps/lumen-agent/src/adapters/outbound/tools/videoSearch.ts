/**
 * search_ad_videos —— 从 Foreplay 广告库拉取真实投放过的短视频，给创作做参考。
 *
 * Foreplay 的 discovery 接口已经按相关度排好序，所以这里默认信任它的顺序；
 * 当返回条数明显多于需要时，再用一个轻量模型按"贴不贴合需求"裁一刀。
 */

import OpenAI from 'openai';

import { type ToolResult, makeToolResult } from '../../../domain/contracts/tools.js';
import { logger } from '../../../platform/logger.js';
import { type JsonSchema, Tool } from './base.js';

/** Foreplay 一条广告创意（字段贴合其响应结构）。 */
interface Creative {
  id: string;
  platform: string;
  landingUrl: string;
  videoUrl: string;
  thumbnail: string;
  headline: string;
  brand: string;
  durationSec: number | null;
  activeDays: number | null;
  format: string;
}

const FOREPLAY_DEFAULT_HOST = 'https://public.api.foreplay.co';

// 裁剪用的小模型及其计费（USD / 百万 token，OpenAI 公开价）。
const RANKER_MODEL = 'gpt-4o-mini';
const RANKER_RATE = { input: 0.15, output: 0.6 };

function asText(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function toCreative(raw: Record<string, unknown>): Creative {
  const platforms = raw.publisher_platform;
  const platformLabel = Array.isArray(platforms) ? platforms.join('/') : asText(platforms);
  const running = (raw.running_duration ?? {}) as { days?: number };
  const durationRaw = raw.video_duration;
  return {
    id: asText(raw.id) || asText(raw.video) || asText(raw.link_url),
    platform: platformLabel || 'Foreplay',
    landingUrl: asText(raw.link_url) || asText(raw.video),
    videoUrl: asText(raw.video),
    thumbnail: asText(raw.thumbnail) || asText(raw.avatar),
    headline: (asText(raw.description) || asText(raw.cta_title) || asText(raw.name)).slice(0, 220),
    brand: asText(raw.name),
    durationSec:
      typeof durationRaw === 'number' ? durationRaw : durationRaw ? Number(durationRaw) : null,
    activeDays: typeof running.days === 'number' ? running.days : null,
    format: asText(raw.display_format),
  };
}

async function queryForeplay(
  query: string,
  apiKey: string,
  host: string,
  take: number,
): Promise<Creative[]> {
  if (!apiKey) {
    logger.warn('缺少 Foreplay 凭证，广告检索已跳过');
    return [];
  }

  const endpoint = new URL('/api/discovery/ads', host.replace(/\/+$/, ''));
  endpoint.searchParams.set('query', query);
  endpoint.searchParams.set('limit', String(take));
  endpoint.searchParams.set('display_format', 'video');
  endpoint.searchParams.set('order', 'most_relevant');

  try {
    const res = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'Foreplay 检索返回非 2xx');
      return [];
    }
    const payload = (await res.json()) as { data?: Array<Record<string, unknown>> };
    return (payload.data ?? []).map(toCreative);
  } catch (err) {
    logger.error({ err }, 'Foreplay 请求异常');
    return [];
  }
}

/** 同一条创意可能重复出现，按其媒体地址收敛，保留首次出现的。 */
function distinct(items: Creative[]): Creative[] {
  const byKey = new Map<string, Creative>();
  for (const item of items) {
    const key = (item.videoUrl || item.landingUrl || item.thumbnail || item.id).toLowerCase();
    if (key && !byKey.has(key)) byKey.set(key, item);
  }
  return [...byKey.values()];
}

/** 候选明显多于需求时，让小模型按贴合度挑选并排序。 */
async function pickBestFit(
  query: string,
  pool: Creative[],
  openai: OpenAI,
  want: number,
): Promise<{ chosen: Creative[]; costUsd: number }> {
  if (pool.length <= want) return { chosen: pool, costUsd: 0 };

  const menu = pool
    .map((c, i) => {
      const tags = [c.platform];
      if (c.brand) tags.push(c.brand);
      if (c.activeDays != null) tags.push(`已投放${c.activeDays}天`);
      if (c.durationSec) tags.push(`${c.durationSec}s`);
      const note = c.headline ? ` — ${c.headline.slice(0, 90)}` : '';
      return `(${i}) ${tags.join(' · ')}${note}`;
    })
    .join('\n');

  const ask = [
    `创作者想找与「${query}」相关的参考广告视频。`,
    `下面是 ${pool.length} 条候选，行首括号里是序号。`,
    `挑出最贴合的 ${want} 条：优先主题相关、投放时间久（说明跑量稳定）的。`,
    '',
    menu,
    '',
    '只返回一个 JSON 数组，元素为选中的序号，按相关度从高到低，例如 [2,0,5]。',
  ].join('\n');

  try {
    const completion = await openai.chat.completions.create({
      model: RANKER_MODEL,
      temperature: 0,
      max_tokens: 120,
      messages: [{ role: 'user', content: ask }],
    });

    const usage = completion.usage;
    const costUsd = usage
      ? (usage.prompt_tokens * RANKER_RATE.input + usage.completion_tokens * RANKER_RATE.output) /
        1_000_000
      : 0;

    const text = (completion.choices[0]?.message.content ?? '')
      .replace(/```[a-z]*|```/g, '')
      .trim();
    const positions = JSON.parse(text) as unknown;
    if (Array.isArray(positions)) {
      const chosen = positions
        .map((p) => pool[Number(p)])
        .filter((c): c is Creative => Boolean(c))
        .slice(0, want);
      if (chosen.length > 0) return { chosen, costUsd };
    }
  } catch (err) {
    logger.warn({ err }, 'LLM 裁剪失败，退回 Foreplay 原始排序');
  }

  // 模型不可用或解析失败：Foreplay 本身按 most_relevant 排序，直接取前 N 条。
  return { chosen: pool.slice(0, want), costUsd: 0 };
}

function render(query: string, picks: Creative[]): string {
  const blocks = picks.map((c, i) => {
    const meta: string[] = [c.platform];
    if (c.brand) meta.push(c.brand);
    if (c.durationSec) meta.push(`${c.durationSec}s`);
    if (c.activeDays != null) meta.push(`投放 ${c.activeDays} 天`);
    const lines = [`${i + 1}. ${meta.join(' · ')}`];
    if (c.headline) lines.push(`   文案：${c.headline}`);
    if (c.videoUrl) lines.push(`   视频：${c.videoUrl}`);
    else if (c.landingUrl) lines.push(`   落地页：${c.landingUrl}`);
    return lines.join('\n');
  });
  return [`「${query}」找到 ${picks.length} 条参考广告：`, '', ...blocks].join('\n');
}

export class VideoSearchTool extends Tool {
  override readonly name = 'search_ad_videos';
  override readonly timeoutSeconds = 60;
  override readonly description = [
    '检索 TikTok / Instagram / Foreplay 广告库里真实投放过的短视频，用作创意参考。',
    '适用于用户想看某个品类/主题的爆款广告、竞品投放或参考创意时。',
    '查询词必须是英文核心关键词：用户若用中文等其他语言描述，先翻译成英文再传入，',
    '且只留核心名词、不要堆形容词（用 "lipstick" 而非 "trending lipstick ugc ads"）。',
  ].join('');

  override readonly parameters: JsonSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: '英文核心关键词，去掉修饰词。',
      },
      count: {
        type: 'integer',
        description: '返回条数，默认 1；需要更多参考时才设 2-3。',
        minimum: 1,
        maximum: 10,
        default: 1,
      },
    },
    required: ['query'],
  };

  private client: OpenAI | null = null;

  constructor(
    private readonly env: {
      foreplayApiKey?: string;
      foreplayBaseUrl?: string;
      openaiApiKey?: string;
    } = {},
  ) {
    super();
  }

  private ranker(): OpenAI | null {
    if (!this.env.openaiApiKey) return null;
    this.client ??= new OpenAI({ apiKey: this.env.openaiApiKey });
    return this.client;
  }

  override async execute(args: Record<string, unknown>): Promise<string | ToolResult> {
    const query = String(args.query ?? '').trim();
    if (!query) return 'Error: query 不能为空';
    const count = Math.min(10, Math.max(1, Number(args.count) || 1));

    // 适度多取，给相关度裁剪留余量；条数少时多给一点冗余。
    const overFetch = Math.min(24, count <= 2 ? count + 6 : count * 3);
    const pool = distinct(
      await queryForeplay(
        query,
        this.env.foreplayApiKey ?? '',
        this.env.foreplayBaseUrl ?? FOREPLAY_DEFAULT_HOST,
        overFetch,
      ),
    );

    if (pool.length === 0) return `没有匹配到广告视频：${query}`;

    const ranker = this.ranker();
    const { chosen, costUsd } = ranker
      ? await pickBestFit(query, pool, ranker, count)
      : { chosen: pool.slice(0, count), costUsd: 0 };

    if (chosen.length === 0) return `没有匹配到广告视频：${query}`;

    return makeToolResult(render(query, chosen), {
      cost_usd: costUsd > 0 ? costUsd : null,
    });
  }
}
