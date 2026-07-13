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
import {
  createNotificationRepositoryLoader,
  initializeDefaultOfficialNotifications,
  runStartupWarmups,
} from './notification-startup';
import { createRepositoryLoader } from './repository-loader';

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

export const getNotificationRepository = createNotificationRepositoryLoader(async () => {
  const db = await getDb();
  return new NotificationRepository(db);
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
 * Eagerly initialize all repositories and startup-only data after the server
 * begins listening. Request-time repository getters may retry their own
 * connection/index initialization, but notification seeding only runs here.
 */
export async function warmupRepositories(): Promise<void> {
  await runStartupWarmups([
    getUserRepository,
    getProjectRepository,
    getProjectFolderRepository,
    getProjectHistoryRepository,
    getHomeFeaturedRepository,
    getHomeWorkflowTemplateRepository,
    getHotVideoRepository,
    () =>
      initializeDefaultOfficialNotifications({
        getRepository: getNotificationRepository,
      }),
    getMaterialAssetRepository,
    getRemakeJobRepository,
    getStudioCache,
  ]);
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
