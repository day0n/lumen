/**
 * search_my_materials —— 在「当前用户的素材库」里做语义向量搜索。
 *
 * 素材在 Studio 上传时已被向量化（OpenAI text-embedding-3-small），向量写在
 * studio_material_assets.embedding 上。运行时本工具只向量化用户的查询词，用
 * MongoDB Atlas Vector Search 按 owner_id 严格隔离地返回该用户最匹配的素材。
 *
 * 与 find_inspiration（全局官方图库）的区别：这里搜的是用户**自己上传**的
 * 商品 / AI 模特 / 真人模特素材，结果按 owner_id 隔离，绝不跨用户。
 */

import { HttpsProxyAgent } from 'https-proxy-agent';
import type { Db, Document } from 'mongodb';
import OpenAI from 'openai';

import { getAgentRequestContext } from '../../../application/requestContext.js';
import { type ToolResult, makeToolResult } from '../../../domain/contracts/tools.js';
import { logger } from '../../../platform/logger.js';
import { type JsonSchema, Tool } from './base.js';

// 与 packages/db 的 MaterialAssetRepository 常量保持一致（agent 不直接依赖 @lumen/db）。
const MATERIAL_ASSETS_COLLECTION = 'studio_material_assets';
const MATERIAL_VECTOR_INDEX = 'material_assets_vector_index';
const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMS = 1536;

const DEFAULT_COUNT = 6;
const MAX_COUNT = 12;
const DEFAULT_MIN_SCORE = 0.3;
const EMBEDDING_REQUEST_TIMEOUT_MS = 8_000;

const MATERIAL_CATEGORIES = ['item', 'character', 'scene'] as const;

function readMinScore(): number {
  const raw = Number(process.env.MATERIAL_MIN_SCORE);
  if (!Number.isFinite(raw) || raw < 0 || raw > 1) return DEFAULT_MIN_SCORE;
  return raw;
}

interface MaterialResult {
  asset_id: string;
  title: string;
  url: string;
  thumbnail_url: string;
  category: string;
  subcategory?: string;
  selling_points: string[];
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

function toResult(doc: Document): MaterialResult | null {
  const url = asString(doc.url);
  if (!url) return null;

  const metadata = (doc.metadata ?? {}) as Record<string, unknown>;
  const subcategory = asString(metadata.subcategory);
  return {
    asset_id: asString(doc._id),
    title: asString(doc.title) || '未命名素材',
    url,
    thumbnail_url: asString(doc.thumbnail_url) || url,
    category: asString(doc.category),
    subcategory: subcategory || undefined,
    selling_points: asStringArray(metadata.selling_points).slice(0, 6),
    score: roundScore(doc.score),
  };
}

function render(query: string, results: MaterialResult[]): string {
  if (results.length === 0) return `素材库里没有找到匹配「${query}」的素材。`;

  const blocks = results.map((item, index) => {
    const meta = [item.category, item.subcategory].filter(Boolean);
    const points =
      item.selling_points.length > 0 ? `卖点：${item.selling_points.slice(0, 4).join('、')}` : '';
    return [
      `${index + 1}. [${item.title}](${item.url})`,
      meta.length > 0 ? `   ${meta.join(' · ')}` : '',
      points ? `   ${points}` : '',
      `   匹配度：${item.score.toFixed(3)}`,
    ]
      .filter(Boolean)
      .join('\n');
  });

  return [`在你的素材库里为「${query}」找到 ${results.length} 个素材：`, '', ...blocks].join('\n');
}

export class MaterialSearchTool extends Tool {
  override readonly name = 'search_my_materials';
  override readonly timeoutSeconds = 45;
  override readonly description = [
    '在「当前用户自己的素材库」里做语义搜索，返回可直接预览的素材 URL。',
    '素材库是用户在 Lumen 上传的商品图(item)、AI 模特(character)、真人模特/场景(scene)等。',
    '当用户说“用我的素材”“我的素材库里有没有 XX”“找我之前上传的 XX 商品/模特图”时调用。',
    '只会返回当前用户自己的素材，不会跨用户，也不包含官方灵感图库（那个用 find_inspiration）。',
    'query 用核心需求即可，例如“红色口红 商品白底图”“亚洲女性 模特 微笑”。',
  ].join('');

  override readonly parameters: JsonSchema = {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        minLength: 2,
        maxLength: 280,
        description: '核心搜索词，提炼成商品/模特/场景的关键描述，去掉“帮我找一下”这类指令。',
      },
      count: {
        type: 'integer',
        minimum: 1,
        maximum: MAX_COUNT,
        default: DEFAULT_COUNT,
        description: '返回素材数量，默认 6，最多 12。',
      },
      category: {
        type: 'string',
        enum: [...MATERIAL_CATEGORIES],
        description: '可选类目过滤：item(商品) / character(AI模特) / scene(真人模特或场景)。',
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
    if (!this.env.db) return 'Error: material search is not configured: missing MongoDB';

    const userId = getAgentRequestContext()?.userId?.trim();
    if (!userId) {
      return 'Error: 无法确定当前用户身份，无法搜索素材库（缺少 agent request context user_id）。';
    }

    const client = this.openai();
    if (!client) return 'Error: material search is not configured: missing OPENAI_API_KEY';

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
      logger.error({ err }, 'search_my_materials embedding failed');
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: failed to generate material query embedding: ${msg}`;
    }

    // owner_id 过滤是硬隔离：向量搜索只在当前用户自己的素材里进行。
    const filter: Record<string, unknown> = {
      owner_id: userId,
      source: 'user_upload',
    };
    const category = cleanFilterValue(args.category);
    if (category) filter.category = category;

    try {
      const pipeline: Document[] = [
        {
          $vectorSearch: {
            index: MATERIAL_VECTOR_INDEX,
            path: 'embedding',
            queryVector,
            numCandidates: Math.max(80, count * 12),
            limit: count,
            filter,
          },
        },
        {
          $project: {
            _id: 1,
            title: 1,
            url: 1,
            thumbnail_url: 1,
            category: 1,
            metadata: 1,
            score: { $meta: 'vectorSearchScore' },
          },
        },
      ];

      const cursor = this.env.db.collection(MATERIAL_ASSETS_COLLECTION).aggregate(pipeline);
      const results: MaterialResult[] = [];
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
          user_id: userId,
          query,
          count,
          min_score: minScore,
          returned: results.length,
          dropped_low_score: droppedLowScore,
          duration_ms: Math.round(performance.now() - started),
        },
        'search_my_materials completed',
      );

      const content = render(query, results);
      return makeToolResult(content, {
        events:
          results.length > 0
            ? [
                {
                  name: 'material_results',
                  data: { query, results },
                },
              ]
            : [],
      });
    } catch (err) {
      logger.error({ err, query }, 'search_my_materials vector search failed');
      const msg = err instanceof Error ? err.message : String(err);
      return `Error: material vector search failed: ${msg}`;
    }
  }
}
