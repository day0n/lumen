/**
 * MongoDB 连接（单例）。
 *
 * 用 mongodb 官方驱动。两个核心 collection：
 *   - agent_sessions：每个 session 一份元数据
 *   - agent_messages：append-only，所有消息（含 display）
 *
 * 索引在 ensureIndexes() 里建（idempotent）。
 */

import { type Db, MongoClient } from 'mongodb';

import { getConfig } from '../config/index.js';
import { logger } from '../observability/logger.js';

let client: MongoClient | null = null;
let db: Db | null = null;

async function getClient(): Promise<MongoClient> {
  if (client) return client;
  const cfg = getConfig();
  client = new MongoClient(cfg.MONGODB_URI, {
    appName: 'lumen-agent',
  });
  await client.connect();
  return client;
}

export async function getMongo(): Promise<Db> {
  if (db) return db;
  const cfg = getConfig();
  const mongoClient = await getClient();
  db = mongoClient.db(cfg.MONGODB_DB);
  await ensureIndexes(db);
  logger.info({ db: cfg.MONGODB_DB }, 'MongoDB 已连接');
  return db;
}

export async function getStudioMongo(): Promise<Db> {
  const cfg = getConfig();
  const mongoClient = await getClient();
  return mongoClient.db(cfg.STUDIO_MONGODB_DB);
}

export async function getWorkflowMongo(): Promise<Db> {
  const cfg = getConfig();
  const mongoClient = await getClient();
  return mongoClient.db(cfg.WORKFLOW_MONGODB_DB);
}

async function ensureIndexes(d: Db): Promise<void> {
  const sessions = d.collection('agent_sessions');
  await sessions.createIndex({ user_id: 1, updated_at: -1 });
  await sessions.createIndex({ updated_at: -1 });

  const messages = d.collection('agent_messages');
  await messages.createIndex({ session_id: 1, seq: 1 }, { unique: true });
  await messages.createIndex({ session_id: 1, role: 1 });

  const memories = d.collection('memories');
  await memories.createIndex({ user_id: 1, hash: 1 }, { unique: true });
  await memories.createIndex({ user_id: 1, updated_at: -1 });
}

export async function closeMongo(): Promise<void> {
  if (client) {
    await client.close();
    client = null;
    db = null;
  }
}
