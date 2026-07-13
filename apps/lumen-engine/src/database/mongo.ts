import { type Db, MongoClient } from 'mongodb';

import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { WorkflowStore } from './workflow-store.js';

interface MongoClientPort<TDatabase> {
  close(): Promise<unknown>;
  connect(): Promise<unknown>;
  db(name: string): TDatabase;
}

export interface MongoRuntime<TDatabase> {
  close(): Promise<void>;
  getStudioDatabase(): Promise<TDatabase>;
  getWorkflowDatabase(): Promise<TDatabase>;
}

export function createMongoRuntime<TDatabase>(options: {
  createClient: () => MongoClientPort<TDatabase>;
  onConnected?: () => void;
  studioDbName: string;
  workflowDbName: string;
}): MongoRuntime<TDatabase> {
  let clientPromise: Promise<MongoClientPort<TDatabase>> | null = null;
  let closingPromise: Promise<void> | null = null;
  let studioDatabasePromise: Promise<TDatabase> | null = null;
  let workflowDatabasePromise: Promise<TDatabase> | null = null;

  const getClient = () => {
    if (clientPromise) return clientPromise;
    if (closingPromise) return Promise.reject(new Error('Mongo runtime is closing'));

    const pending = (async () => {
      const client = options.createClient();
      try {
        await client.connect();
        options.onConnected?.();
        return client;
      } catch (error) {
        await client.close().catch(() => undefined);
        throw error;
      }
    })();
    const tracked = pending.catch((error) => {
      if (clientPromise === tracked) clientPromise = null;
      throw error;
    });
    clientPromise = tracked;
    return tracked;
  };

  return {
    async getWorkflowDatabase() {
      if (workflowDatabasePromise) return workflowDatabasePromise;
      const pending = getClient().then((client) => client.db(options.workflowDbName));
      const tracked = pending.catch((error) => {
        if (workflowDatabasePromise === tracked) workflowDatabasePromise = null;
        throw error;
      });
      workflowDatabasePromise = tracked;
      return workflowDatabasePromise;
    },

    async getStudioDatabase() {
      if (studioDatabasePromise) return studioDatabasePromise;
      const pending = getClient().then((client) => client.db(options.studioDbName));
      const tracked = pending.catch((error) => {
        if (studioDatabasePromise === tracked) studioDatabasePromise = null;
        throw error;
      });
      studioDatabasePromise = tracked;
      return studioDatabasePromise;
    },

    async close() {
      if (closingPromise) return closingPromise;
      const pending = clientPromise;
      clientPromise = null;
      workflowDatabasePromise = null;
      studioDatabasePromise = null;
      if (!pending) return;

      const closing = (async () => {
        let client: MongoClientPort<TDatabase>;
        try {
          client = await pending;
        } catch {
          return;
        }
        await client.close();
      })();
      const tracked = closing.finally(() => {
        if (closingPromise === tracked) closingPromise = null;
      });
      closingPromise = tracked;
      return tracked;
    },
  };
}

const runtime = createMongoRuntime<Db>({
  createClient: () =>
    new MongoClient(config.MONGODB_URI, {
      appName: 'lumen-engine',
    }),
  workflowDbName: config.MONGODB_DB,
  studioDbName: config.STUDIO_MONGODB_DB,
  onConnected: () => {
    logger.info(
      { studioDb: config.STUDIO_MONGODB_DB, workflowDb: config.MONGODB_DB },
      'MongoDB connected',
    );
  },
});

export async function getMongo(): Promise<Db> {
  return runtime.getWorkflowDatabase();
}

export async function getStudioMongo(): Promise<Db> {
  return runtime.getStudioDatabase();
}

export async function getWorkflowStore(): Promise<WorkflowStore> {
  const mongo = await getMongo();
  const store = new WorkflowStore(mongo);
  await store.ensureIndexes();
  return store;
}

export async function closeMongo(): Promise<void> {
  await runtime.close();
}
