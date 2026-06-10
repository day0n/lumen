/**
 * find_inspiration —— 搜索 Lumen 官方灵感图库。
 *
 * 图片预先由 seed 脚本生成并上传到 R2，运行时只向量化用户需求和图库标签，
 * 用 MongoDB Atlas Vector Search 返回最贴近的 CDN 图片 URL。
 */

import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Db, Document } from 'mongodb';
import OpenAI from 'openai';

import { type ToolResult, makeToolResult } from '../../../domain/contracts/tools.js';
import { logger } from '../../../platform/logger.js';
import { type JsonSchema, Tool } from './base.js';

export const INSPIRATION_ASSETS_COLLECTION = 'inspiration_assets';
export const INSPIRATION_VECTOR_INDEX = 'inspiration_tags_vector_index';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMS = 1536;
const DEFAULT_COUNT = 6;
const MAX_COUNT = 12;
const EMBEDDING_REQUEST_TIMEOUT_MS = 8_000;

// 相似度地板：Atlas cosine 分数归一化到 [0,1]（0.5≈正交）。
// 默认设得很宽松，只挡掉明显不相关的；想更严就调高 INSPIRATION_MIN_SCORE。
const DEFAULT_MIN_SCORE = 0.3;

function readMinScore(): number {
  const raw = Number(process.env.INSPIRATION_MIN_SCORE);
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return DEFAULT_MIN_SCORE;
  return raw;
}

interface InspirationFacets {
  era?: string;
  scene?: string;
  style?: string;
  subject?: string;
  mood?: string;
  color?: string;
  region?: string;
  aspect_ratio?: string;
}

interface InspirationResult {
  asset_id: string;
  title: string;
  description: string;
  url: string;
  thumbnail_url: string;
  category: string;
  tags: string[];
  facets: InspirationFacets;
  score: number;
}

function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => asString(item)).filter((item) => item.length > 0)
    : [];
}

function cleanFilterValue(value: unknown): string | null {
  const text = asString(value);
  return text.length > 0 ? text : null;
}

function roundScore(value: unknown): number {
  return Math.round((typeof value === 'number' ? value : 0) * 10_000) / 10_000;
}

function readProxyUrl(): string | null {
  return (
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy ??
    null
  );
}

function toResult(doc: Document): InspirationResult | null {
  const url = asString(doc.cdn_url);
  if (!url) return null;

  const tags = [...asStringArray(doc.tags_zh), ...asStringArray(doc.tags_en)];
  const facets = (doc.facets ?? {}) as Record<string, unknown>;
  return {
    asset_id: asString(doc.asset_id) || asString(doc._id),
    title: asString(doc.title) || 'Untitled inspiration',
    description: asString(doc.description),
    url,
    thumbnail_url: asString(doc.thumbnail_url) || url,
    category: asString(doc.category),
    tags: [...new Set(tags)].slice(0, 12),
    facets: {
      era: asString(facets.era) || undefined,
      scene: asString(facets.scene) || undefined,
      style: asString(facets.style) || undefined,
      subject: asString(facets.subject) || undefined,
      mood: asString(facets.mood) || undefined,
      color: asString(facets.color) || undefined,
      region: asString(facets.region) || undefined,
      aspect_ratio: asString(facets.aspect_ratio) || undefined,
    },
    score: roundScore(doc.score),
  };
}

function render(query: string, results: InspirationResult[]): string {
  if (results.length === 0) return `没有在灵感图库里找到匹配图片：${query}`;

  const blocks = results.map((item, index) => {
    const meta = [
      item.category,
      item.facets.era,
      item.facets.scene,
      item.facets.style,
      item.facets.aspect_ratio,
    ].filter(Boolean);
    const tags = item.tags.length > 0 ? `标签：${item.tags.slice(0, 8).join('、')}` : '';
    return [
      `${index + 1}. [${item.title}](${item.url})`,
      meta.length > 0 ? `   ${meta.join(' · ')}` : '',
      item.description ? `   ${item.description}` : '',
      tags ? `   ${tags}` : '',
      `   匹配度：${item.score.toFixed(3)}`,
    ]
      .filter(Boolean)
      .join('\n');
  });

  return [`为「${query}」找到 ${results.length} 张参考图：`, '', ...blocks].join('\n');
}

export class InspirationSearchTool extends Tool {
  override readonly name = 'find_inspiration';
  override readonly timeoutSeconds = 45;
  override readonly description = [
    '搜索 Lumen 官方灵感图库，返回可直接预览的图片 CDN URL。',
    '适用于用户想找视觉参考、年代风格、商品拍摄氛围、场景图、广告静帧、色彩/构图灵感时。',
    '图库图片由平台预生成并存在 R2；本工具只做标签向量搜索，不会实时联网抓图。',
    'query 可以用用户原语言，但要提炼成核心视觉需求，例如“1990s automotive film photo garage chrome dashboard”。',
  ].join('');

  override readonly parameters: JsonSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        minLength: 2,
        maxLength: 280,
        description:
          '核心视觉搜索词。保留年代、品类、场景、风格、主体、情绪；去掉“帮我找一些”这类指令。',
      },
      count: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_COUNT,
        default: DEFAULT_COUNT,
        description: '返回图片数量，默认 6，最多 12。',
      },
      category: {
        type: 'string',
        description:
          '可选分类过滤，例如 automotive、people、accessories、fashion、beauty、food、electronics、lifestyle、travel、architecture、interiors、workspace、sports、wellness、outdoors、hospitality、packaging、industrial、music、gaming、art、education、finance、medical、nature、events、furniture、fragrance、beverage、gardening、homecare、diy、real_estate。',
      },
      era: {
        type: 'string',
        description: '可选年代过滤，例如 1990s、1980s、y2k。',
      },
      style: {
        type: 'string',
        description: '可选风格过滤，例如 film photo、editorial、catalog、documentary。',
      },
      aspect_ratio: {
        type: 'string',
        description: '可选画幅过滤，例如 9:16、4:5、1:1、16:9。',
      },
    },
    required: ['query'],
  };

  private client: OpenAI | null = null;

  constructor(
    private readonly env: {
      db?: Db;
      openaiApiKey?: string;
    } = {},
  ) {
    super();
  }

  private openai(): OpenAI | null {
    if (!this.env.openaiApiKey) return null;
    const proxy = readProxyUrl();
    this.client ??= new OpenAI({
      apiKey: this.env.openaiApiKey,
      maxRetries: 0,
      timeout: EMBEDDING_REQUEST_TIMEOUT_MS,
      ...(proxy ? { httpAgent: new HttpsProxyAgent(proxy) } : {}),
    });
    return this.client;
  }

  override async execute(args: Record<string, unknown>): Promise<string | ToolResult> {
    const query = asString(args.query);
    if (!query) return 'Error: query 不能为空';
    if (!this.env.db) return 'Error: inspiration search is not configured: missing MongoDB';

    const client = this.openai();
    if (!client) return 'Error: inspiration search is not configured: missing OPENAI_API_KEY';

    const count = Math.min(MAX_COUNT, Math.max(1, Number(args.count) || DEFAULT_COUNT));
    const minScore = readMinScore();
    const started = performance.now();

    let queryVector: number[];
    try {
      const response = await client.embeddings.create({
        model: EMBEDDING_MODEL,
        input: query,
        dimensions: EMBEDDING_DIMS,
      });
      queryVector = response.data[0]!.embedding;
    } catch (err) {
      logger.error({ err }, 'find_inspiration embedding failed');
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: failed to generate inspiration query embedding: ${msg}`;
    }

    const filter: Record<string, unknown> = {
      status: 'published',
      kind: 'image',
    };
    const category = cleanFilterValue(args.category);
    const era = cleanFilterValue(args.era);
    const style = cleanFilterValue(args.style);
    const aspectRatio = cleanFilterValue(args.aspect_ratio);
    if (category) filter.category = category;
    if (era) filter['facets.era'] = era;
    if (style) filter['facets.style'] = style;
    if (aspectRatio) filter['facets.aspect_ratio'] = aspectRatio;

    try {
      const pipeline: Document[] = [
        {
          $vectorSearch: {
            index: INSPIRATION_VECTOR_INDEX,
            path: 'embedding_tags',
            queryVector,
            numCandidates: Math.max(80, count * 12),
            limit: count,
            filter,
          },
        },
        {
          $project: {
            _id: 1,
            asset_id: 1,
            title: 1,
            description: 1,
            cdn_url: 1,
            thumbnail_url: 1,
            category: 1,
            facets: 1,
            tags_zh: 1,
            tags_en: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ];

      const cursor = this.env.db.collection(INSPIRATION_ASSETS_COLLECTION).aggregate(pipeline);
      const results: InspirationResult[] = [];
      let droppedLowScore = 0;
      for await (const doc of cursor) {
        const item = toResult(doc);
        if (!item) continue;
        if (item.score < minScore) {
          droppedLowScore += 1;
          continue;
        }
        results.push(item);
      }

      logger.info(
        {
          query,
          count,
          min_score: minScore,
          returned: results.length,
          dropped_low_score: droppedLowScore,
          duration_ms: Math.round(performance.now() - started),
        },
        'find_inspiration completed',
      );

      const content = render(query, results);
      return makeToolResult(content, {
        events:
          results.length > 0
            ? [
                {
                  name: 'inspiration_results',
                  data: { query, results },
                },
              ]
            : [],
      });
    } catch (err) {
      logger.error({ err, query }, 'find_inspiration vector search failed');
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: inspiration vector search failed: ${msg}`;
    }
  }
}
