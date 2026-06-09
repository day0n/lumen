import type { Db } from 'mongodb';
import { MongoClient } from 'mongodb';

export interface MongoDatabaseOptions {
  uri: string;
  dbName: string;
  appName?: string;
}

type MongoCache = Map<string, Promise<MongoClient>>;

const globalMongo = globalThis as typeof globalThis & {
  __lumenMongoClients?: MongoCache;
};

function getCache() {
  globalMongo.__lumenMongoClients ??= new Map<string, Promise<MongoClient>>();
  return globalMongo.__lumenMongoClients;
}

// Cache MongoClients by URI only. A single MongoClient can serve any number
// of databases via `client.db(name)`, and the connection pool is on the
// client. Previously we keyed on `${appName}:${dbName}:${uri}`, which
// produced two independent MongoClients (and two pools) whenever Studio
// touched both `lumen_app` and the workflow db with different appName tags.
// Studio runs with maxPoolSize=10, so that doubled the resident connection
// count for no benefit. The first appName wins for telemetry purposes.
function getCacheKey(options: MongoDatabaseOptions) {
  return options.uri;
}

export async function getMongoDatabase(options: MongoDatabaseOptions): Promise<Db> {
  if (!options.uri.trim()) {
    throw new Error('MongoDB uri is required');
  }
  if (!options.dbName.trim()) {
    throw new Error('MongoDB database name is required');
  }

  const cache = getCache();
  const cacheKey = getCacheKey(options);
  let clientPromise = cache.get(cacheKey);

  if (!clientPromise) {
    clientPromise = new MongoClient(options.uri, {
      appName: options.appName ?? 'lumen',
      ignoreUndefined: true,
      maxPoolSize: 20,
    })
      .connect()
      .catch((error) => {
        cache.delete(cacheKey);
        throw error;
      });
    cache.set(cacheKey, clientPromise);
  }

  const client = await clientPromise;
  return client.db(options.dbName);
}

export async function closeMongoDatabases(): Promise<void> {
  const cache = getCache();
  const clients = await Promise.allSettled([...cache.values()]);
  cache.clear();

  await Promise.all(
    clients.map(async (result) => {
      if (result.status === 'fulfilled') {
        await result.value.close();
      }
    }),
  );
}
