import { type Db, MongoClient } from 'mongodb';

import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { WorkflowStore } from './workflow-store.js';

let client: MongoClient | null = null;
let db: Db | null = null;

export async function getMongo(): Promise<Db> {
  if (db) return db;

  client = new MongoClient(config.MONGODB_URI, {
    appName: 'lumen-engine',
  });
  await client.connect();
  db = client.db(config.MONGODB_DB);
  logger.info({ db: config.MONGODB_DB }, 'MongoDB connected');
  return db;
}

export async function getWorkflowStore(): Promise<WorkflowStore> {
  const mongo = await getMongo();
  const store = new WorkflowStore(mongo);
  await store.ensureIndexes();
  return store;
}

export async function closeMongo(): Promise<void> {
  if (!client) return;
  await client.close();
  client = null;
  db = null;
}
