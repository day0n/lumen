/**
 * Long-term memory — 基于 MongoDB Atlas Vector Search + OpenAI embedding。
 *
 * 两个核心操作：
 *   - retrieve: embed query → $vectorSearch → 返回相关记忆
 *   - store: LLM 提取用户事实 → embed → upsert 到 memories collection
 */

import type { Collection, Db } from 'mongodb';
import OpenAI from 'openai';

import { logger } from '../observability/logger.js';

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

const FACT_EXTRACTION_PROMPT = `You are a Personal Information Organizer. Extract ONLY long-term, reusable facts about the user. A fact qualifies only if it would still be useful when the user returns in a completely different conversation about a completely different topic.

## What TO extract
1. Personal identity: name, age, location
2. Professional details: job title, company, industry, skills, expertise level
3. Stable preferences: favorite tools, frameworks, design styles, content formats, aspect ratios
4. Long-term goals: career goals, business objectives, creative direction
5. Constraints: dietary restrictions, accessibility needs, timezone, budget range
6. Working style: communication preferences, collaboration habits
7. Language preferences: preferred conversation language, requested deliverable / ad / target-market languages

## What NOT to extract
1. One-time task requests ("help me build X", "make a video")
2. Current conversation instructions or questions
3. Ephemeral context that only matters for the current session
4. Anything the assistant said (only extract from user messages)
5. Generic statements or greetings

## Language rule
Record each fact in the same language as the user message it came from. Do not translate.

Return facts in JSON format: {"facts": ["fact1", "fact2"]}
Only extract from user messages. If no long-term facts found, return {"facts": []}`;

export class MemoryManager {
  private collection: Collection<MemoryDoc>;
  private openai: OpenAI;

  constructor(db: Db, openaiApiKey: string) {
    this.collection = db.collection<MemoryDoc>('memories');
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
      const parsed = JSON.parse(text) as { facts?: string[] };
      return (parsed.facts ?? []).filter((f) => f.trim().length > 0);
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
  return `\n<user_memory>\nHere is what you remember about this user from previous conversations:\n${lines}\n</user_memory>\n`;
}
