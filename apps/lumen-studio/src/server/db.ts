import 'server-only';

import {
  HomeFeaturedRepository,
  HotVideoRepository,
  JsonCache,
  NotificationRepository,
  ProjectRepository,
  UserRepository,
  getMongoDatabase,
  getRedisClient,
} from '@lumen/db';

import { getStudioServerConfig } from './config';

let projectRepositoryPromise: Promise<ProjectRepository> | null = null;
let userRepositoryPromise: Promise<UserRepository> | null = null;
let homeFeaturedRepositoryPromise: Promise<HomeFeaturedRepository> | null = null;
let hotVideoRepositoryPromise: Promise<HotVideoRepository> | null = null;
let notificationRepositoryPromise: Promise<NotificationRepository> | null = null;
let cache: JsonCache | null = null;

async function getDb() {
  const config = getStudioServerConfig();
  return getMongoDatabase({
    uri: config.MONGODB_URI,
    dbName: config.MONGODB_DB,
    appName: 'lumen-studio',
  });
}

export async function getProjectRepository(): Promise<ProjectRepository> {
  if (projectRepositoryPromise) return projectRepositoryPromise;

  projectRepositoryPromise = (async () => {
    const db = await getDb();
    const repository = new ProjectRepository(db);
    await repository.ensureIndexes();
    return repository;
  })();

  return projectRepositoryPromise;
}

export async function getUserRepository(): Promise<UserRepository> {
  if (userRepositoryPromise) return userRepositoryPromise;

  userRepositoryPromise = (async () => {
    const db = await getDb();
    const repository = new UserRepository(db);
    await repository.ensureIndexes();
    return repository;
  })();

  return userRepositoryPromise;
}

export async function getHomeFeaturedRepository(): Promise<HomeFeaturedRepository> {
  if (homeFeaturedRepositoryPromise) return homeFeaturedRepositoryPromise;

  homeFeaturedRepositoryPromise = (async () => {
    const db = await getDb();
    const repository = new HomeFeaturedRepository(db);
    await repository.ensureIndexes();
    return repository;
  })();

  return homeFeaturedRepositoryPromise;
}

export async function getHotVideoRepository(): Promise<HotVideoRepository> {
  if (hotVideoRepositoryPromise) return hotVideoRepositoryPromise;

  hotVideoRepositoryPromise = (async () => {
    const db = await getDb();
    const repository = new HotVideoRepository(db);
    await repository.ensureIndexes();
    return repository;
  })();

  return hotVideoRepositoryPromise;
}

export async function getNotificationRepository(): Promise<NotificationRepository> {
  if (notificationRepositoryPromise) return notificationRepositoryPromise;

  notificationRepositoryPromise = (async () => {
    const db = await getDb();
    const repository = new NotificationRepository(db);
    await repository.ensureIndexes();
    return repository;
  })();

  return notificationRepositoryPromise;
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
