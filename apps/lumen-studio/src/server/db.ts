// 注意：不要在此文件加 `import 'server-only'`。生产用 `tsx server.ts` 裸 Node
// 启动，server.ts 会 import 本模块做连接预热；server-only 包在非 react-server
// 条件下解析为一个直接 throw 的模块，会导致启动崩溃。本模块本就只在服务端用。
import {
  HomeFeaturedRepository,
  HomeWorkflowTemplateRepository,
  HotVideoRepository,
  JsonCache,
  MaterialAssetRepository,
  NotificationRepository,
  ProjectFolderRepository,
  ProjectHistoryRepository,
  ProjectRepository,
  RemakeJobRepository,
  UserRepository,
  getMongoDatabase,
  getRedisClient,
} from '@lumen/db';

import { getStudioServerConfig } from './config';

/**
 * Memoize an async repository loader. The resolved promise is cached so the
 * client connect + ensureIndexes only runs once per process. If the loader
 * rejects, the cache is reset so the next call retries instead of returning a
 * permanently-rejected promise.
 */
function createRepositoryLoader<T>(factory: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => {
    if (promise) return promise;
    promise = factory().catch((error) => {
      promise = null;
      throw error;
    });
    return promise;
  };
}

let cache: JsonCache | null = null;

async function getDb() {
  const config = getStudioServerConfig();
  return getMongoDatabase({
    uri: config.MONGODB_URI,
    dbName: config.MONGODB_DB,
    appName: 'lumen-studio',
  });
}

async function getWorkflowDb() {
  const config = getStudioServerConfig();
  return getMongoDatabase({
    uri: config.MONGODB_URI,
    dbName: config.WORKFLOW_MONGODB_DB,
    appName: 'lumen-studio-workflow',
  });
}

export const getProjectRepository = createRepositoryLoader(async () => {
  const db = await getDb();
  const repository = new ProjectRepository(db);
  await repository.ensureIndexes();
  return repository;
});

export const getUserRepository = createRepositoryLoader(async () => {
  const db = await getDb();
  const repository = new UserRepository(db);
  await repository.ensureIndexes();
  return repository;
});

export const getHomeFeaturedRepository = createRepositoryLoader(async () => {
  const db = await getDb();
  const repository = new HomeFeaturedRepository(db);
  await repository.ensureIndexes();
  return repository;
});

export const getHomeWorkflowTemplateRepository = createRepositoryLoader(async () => {
  const db = await getDb();
  const repository = new HomeWorkflowTemplateRepository(db);
  await repository.ensureIndexes();
  return repository;
});

export const getHotVideoRepository = createRepositoryLoader(async () => {
  const db = await getDb();
  const repository = new HotVideoRepository(db);
  await repository.ensureIndexes();
  return repository;
});

export const getNotificationRepository = createRepositoryLoader(async () => {
  const db = await getDb();
  const repository = new NotificationRepository(db);
  await repository.ensureIndexes();
  return repository;
});

export const getMaterialAssetRepository = createRepositoryLoader(async () => {
  const db = await getWorkflowDb();
  const repository = new MaterialAssetRepository(db);
  await repository.ensureIndexes();
  return repository;
});

export const getProjectHistoryRepository = createRepositoryLoader(async () => {
  const db = await getDb();
  const repository = new ProjectHistoryRepository(db);
  await repository.ensureIndexes();
  return repository;
});

export const getProjectFolderRepository = createRepositoryLoader(async () => {
  const db = await getDb();
  const repository = new ProjectFolderRepository(db);
  await repository.ensureIndexes();
  return repository;
});

export const getRemakeJobRepository = createRepositoryLoader(async () => {
  const db = await getDb();
  const repository = new RemakeJobRepository(db);
  await repository.ensureIndexes();
  return repository;
});

/**
 * Eagerly initialize all repositories (Mongo connect + ensureIndexes) so the
 * cold-start cost is paid at boot instead of by the first user request after a
 * deploy/restart. Failures are logged but non-fatal — the lazy getters will
 * retry on demand.
 */
export async function warmupRepositories(): Promise<void> {
  await Promise.allSettled([
    getUserRepository(),
    getProjectRepository(),
    getProjectFolderRepository(),
    getProjectHistoryRepository(),
    getHomeFeaturedRepository(),
    getHomeWorkflowTemplateRepository(),
    getHotVideoRepository(),
    getNotificationRepository(),
    getMaterialAssetRepository(),
    getRemakeJobRepository(),
  ]);
  try {
    getStudioCache();
  } catch {}
}

export function getStudioCache(): JsonCache {
  if (cache) return cache;

  const config = getStudioServerConfig();
  const redis = getRedisClient({
    url: config.REDIS_URL,
    keyPrefix: 'lumen:studio:',
  });
  cache = new JsonCache(redis);
  return cache;
}
