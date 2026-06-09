import 'server-only';

import { MATERIAL_EMBEDDING_DIMS, MATERIAL_EMBEDDING_MODEL } from '@lumen/db';
import { HttpsProxyAgent } from 'https-proxy-agent';
import OpenAI from 'openai';

import { logger } from './logger';

/**
 * 素材库向量化助手。
 *
 * 入库端（studio）与查询端（agent）必须用同一个 embedding 模型，向量才可比，
 * 因此模型 / 维度常量统一从 @lumen/db 取。这里所有方法都是 best-effort：
 * 没配 OPENAI_API_KEY 或调用失败时返回 null，让调用方「素材照常入库、只是暂不
 * 可被语义检索」，绝不阻断上传主流程。
 */

let cachedClient: OpenAI | null = null;
const EMBEDDING_REQUEST_TIMEOUT_MS = 8_000;

function readProxyUrl(): string | null {
  return (
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy ??
    null
  );
}

function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return null;
  if (cachedClient) return cachedClient;

  const proxy = readProxyUrl();
  cachedClient = new OpenAI({
    apiKey,
    maxRetries: 0,
    timeout: EMBEDDING_REQUEST_TIMEOUT_MS,
    ...(proxy ? { httpAgent: new HttpsProxyAgent(proxy) } : {}),
  });
  return cachedClient;
}

const CATEGORY_LABELS: Record<string, string> = {
  item: '商品素材 product asset',
  character: 'AI模特素材 AI model asset',
  scene: '真人模特素材 real model asset',
  my_assets: '工作流产出素材 workflow result asset',
};

export interface MaterialEmbeddingInput {
  category: string;
  title: string;
  subcategory?: string;
  sellingPoints?: string[];
}

/**
 * 把素材元数据拼成用于向量化的文本。中英混排，text-embedding-3-small 能很好处理。
 * 返回空串表示没有可向量化的信息（调用方应跳过 embedding）。
 */
export function buildMaterialEmbeddingText(input: MaterialEmbeddingInput): string {
  const lines: string[] = [];
  const categoryLabel = CATEGORY_LABELS[input.category] ?? input.category;
  if (categoryLabel) lines.push(`类目 category: ${categoryLabel}`);
  if (input.subcategory?.trim()) lines.push(`子类 subcategory: ${input.subcategory.trim()}`);
  if (input.title?.trim()) lines.push(`标题 title: ${input.title.trim()}`);
  const points = (input.sellingPoints ?? []).map((p) => p.trim()).filter(Boolean);
  if (points.length) lines.push(`卖点 selling points: ${points.join('；')}`);
  return lines.join('\n').slice(0, 4000);
}

export interface MaterialEmbedding {
  vector: number[];
  text: string;
  model: string;
}

/**
 * 对素材元数据做向量化。失败 / 未配置时返回 null（best-effort）。
 */
export async function embedMaterial(
  input: MaterialEmbeddingInput,
): Promise<MaterialEmbedding | null> {
  const text = buildMaterialEmbeddingText(input);
  if (!text) return null;

  const client = getOpenAIClient();
  if (!client) {
    logger.warn('material embedding skipped: OPENAI_API_KEY is not configured');
    return null;
  }

  try {
    const response = await client.embeddings.create({
      model: MATERIAL_EMBEDDING_MODEL,
      input: text,
      dimensions: MATERIAL_EMBEDDING_DIMS,
    });
    const vector = response.data[0]?.embedding;
    if (!vector?.length) return null;
    return { vector, text, model: MATERIAL_EMBEDDING_MODEL };
  } catch (error) {
    logger.warn({ err: error }, 'material embedding failed (asset will be stored without vector)');
    return null;
  }
}
