/**
 * Long-term memory — 基于 MongoDB Atlas Vector Search + OpenAI embedding。
 *
 * 两个核心操作：
 *   - retrieve: embed query → $vectorSearch → 返回相关记忆
 *   - store: LLM 提取用户事实 → embed → upsert 到 memories collection
 */

import type { Collection, Db } from 'mongodb';
import OpenAI from 'openai';

import { logger } from '../../platform/logger.js';

const EMBEDDING_MODEL = 'text-embedding-3-small';
const EMBEDDING_DIMS = 1536;
const FACT_EXTRACTION_MODEL = 'gpt-4o-mini';
const MIN_RELEVANCE_SCORE = 0.6;
const VECTOR_INDEX_NAME = 'memory_vector_index';

export interface MemoryEntry {
  content: string;
  score: number;
  created_at: Date;
}

interface MemoryDoc {
  user_id: string;
  memory: string;
  embedding: number[];
  hash: string;
  created_at: Date;
  updated_at: Date;
}

const FACT_EXTRACTION_PROMPT = `你的职责是从对话中挑出值得长期记住的用户信息，供日后完全不同的对话复用。

判断标准只有一条：这条信息在用户下次带着另一个话题回来时，是否仍然有参考价值。能通过就记，不能通过就丢。

值得记录的方向（不限于此，按语义判断）：
- 身份信息：称呼/姓名、所在地区、所属年龄段
- 职业背景：岗位、所在公司或行业、擅长的技能、专业程度
- 稳定偏好：惯用的工具与框架、审美与风格取向、内容形态、画幅比例
- 长期目标：职业规划、业务目标、创作方向
- 固定约束：时区、预算区间、无障碍需求、饮食禁忌等
- 协作方式：沟通习惯、对回复风格的偏好
- 语言习惯：偏好的对话语言，以及对交付物/广告/目标市场所要求的语言

应当忽略：
- 一次性的任务诉求（如“帮我做个视频”“搭一个 X”）
- 仅服务于当前这轮对话的指令或提问
- 只在本次会话内有意义的临时上下文
- 助手自己说过的话（只从用户消息里提取）
- 寒暄与缺乏信息量的泛泛之谈

语言要求：每条信息用它所在用户消息的原语言记录，不要翻译。

输出 JSON：{"items": ["信息1", "信息2"]}。若没有可长期保留的信息，返回 {"items": []}。`;

export class MemoryManager {
  private collection: Collection<MemoryDoc>;
  private openai: OpenAI;

  constructor(db: Db, openaiApiKey: string) {
    this.collection = db.collection<MemoryDoc>('recall_store');
    this.openai = new OpenAI({ apiKey: openaiApiKey });
  }

  async retrieve(userId: string, query: string, limit = 5): Promise<MemoryEntry[]> {
    if (!userId || !query) return [];

    const started = performance.now();
    try {
      const queryVector = await this.embed(query);

      const pipeline = [
        {
          $vectorSearch: {
            index: VECTOR_INDEX_NAME,
            path: 'embedding',
            queryVector,
            numCandidates: limit * 10,
            limit,
            filter: { user_id: userId },
          },
        },
        {
          $project: {
            _id: 0,
            memory: 1,
            score: { $meta: 'vectorSearchScore' },
            created_at: 1,
          },
        },
      ];

      const results: MemoryEntry[] = [];
      const cursor = this.collection.aggregate(pipeline);
      for await (const doc of cursor) {
        const d = doc as { memory: string; score: number; created_at: Date };
        if (d.score >= MIN_RELEVANCE_SCORE) {
          results.push({ content: d.memory, score: d.score, created_at: d.created_at });
        }
      }

      logger.debug(
        {
          user_id: userId,
          query_len: query.length,
          results: results.length,
          duration_ms: Math.round(performance.now() - started),
        },
        'Memory retrieve done',
      );
      return results;
    } catch (err) {
      logger.warn({ err, user_id: userId }, 'Memory retrieve failed');
      return [];
    }
  }

  async store(userId: string, messages: Array<{ role: string; content: string }>): Promise<void> {
    if (!userId || messages.length === 0) return;

    const started = performance.now();
    try {
      const facts = await this.extractFacts(messages);
      if (facts.length === 0) return;

      for (const fact of facts) {
        const hash = simpleHash(`${userId}:${fact}`);
        const existing = await this.collection.findOne({ user_id: userId, hash });
        if (existing) continue;

        const embedding = await this.embed(fact);
        await this.collection.insertOne({
          user_id: userId,
          memory: fact,
          embedding,
          hash,
          created_at: new Date(),
          updated_at: new Date(),
        });
      }

      logger.debug(
        {
          user_id: userId,
          facts_extracted: facts.length,
          duration_ms: Math.round(performance.now() - started),
        },
        'Memory store done',
      );
    } catch (err) {
      logger.warn({ err, user_id: userId }, 'Memory store failed');
    }
  }

  private async extractFacts(
    messages: Array<{ role: string; content: string }>,
  ): Promise<string[]> {
    const conversation = messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => `${m.role}: ${m.content}`)
      .join('\n');

    const resp = await this.openai.chat.completions.create({
      model: FACT_EXTRACTION_MODEL,
      temperature: 0.1,
      messages: [
        { role: 'system', content: FACT_EXTRACTION_PROMPT },
        { role: 'user', content: conversation },
      ],
      response_format: { type: 'json_object' },
    });

    const text = resp.choices[0]?.message?.content ?? '{}';
    try {
      const parsed = JSON.parse(text) as { items?: string[] };
      return (parsed.items ?? []).filter((f) => f.trim().length > 0);
    } catch {
      logger.warn({ raw: text }, 'Failed to parse fact extraction response');
      return [];
    }
  }

  private async embed(text: string): Promise<number[]> {
    const resp = await this.openai.embeddings.create({
      model: EMBEDDING_MODEL,
      input: text,
      dimensions: EMBEDDING_DIMS,
    });
    return resp.data[0]!.embedding;
  }
}

function simpleHash(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return h.toString(36);
}

export function formatMemoriesForPrompt(memories: MemoryEntry[]): string {
  if (memories.length === 0) return '';
  const lines = memories.map((m) => `- ${m.content}`).join('\n');
  return `\n<recalled_user_context>\n以下是过往对话中沉淀下来、关于当前用户的长期信息，可作为参考：\n${lines}\n</recalled_user_context>\n`;
}
