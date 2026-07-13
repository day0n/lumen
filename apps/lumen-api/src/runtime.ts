import {
  createAuthenticatedUserService,
  createHomeQueryService,
  createNotificationService,
  createProjectDetailQueryService,
  createProjectQueryService,
  seedDefaultOfficialNotifications,
} from '@lumen/backend';
import {
  HomeFeaturedItemRecordSchema,
  HomeFeaturedRepository,
  HomeWorkflowTemplateListRecordSchema,
  HomeWorkflowTemplateRepository,
  JsonCache,
  NotificationRepository,
  type ProjectCanvas,
  ProjectListRecordSchema,
  type ProjectRecord,
  ProjectRecordSchema,
  ProjectRepository,
  UserRepository,
  WorkflowNodeResultRepository,
  closeMongoDatabases,
  closeRedisClients,
  getMongoDatabase,
  getRedisClient,
} from '@lumen/db';

import type { ReadinessChecks } from './app.js';
import { createIdentityProvider } from './auth/identity-provider.js';
import type { ApiConfig } from './config.js';

const DEFAULT_API_RUNTIME_INITIALIZATION_ATTEMPTS = 3;
const DEFAULT_API_RUNTIME_INITIALIZATION_RETRY_DELAY_MS = 250;

export function createApiRuntime(config: ApiConfig) {
  const { getDatabase, getWorkflowDatabase } = createApiDatabaseLoaders(config);
  const getFeaturedRepository = memoizeAsync(async () => {
    const repository = new HomeFeaturedRepository(await getDatabase());
    await repository.ensureIndexes();
    return repository;
  });
  const getTemplateRepository = memoizeAsync(async () => {
    const repository = new HomeWorkflowTemplateRepository(await getDatabase());
    await repository.ensureIndexes();
    return repository;
  });
  const getUserRepository = memoizeAsync(async () => {
    const repository = new UserRepository(await getDatabase());
    await repository.ensureIndexes();
    return repository;
  });
  const getProjectRepository = memoizeAsync(async () => {
    const repository = new ProjectRepository(await getDatabase());
    await repository.ensureIndexes();
    return repository;
  });
  const getWorkflowNodeResultRepository = memoizeAsync(async () => {
    const repository = new WorkflowNodeResultRepository(await getWorkflowDatabase());
    await repository.ensureIndexes();
    return repository;
  });
  const notificationRuntime = createNotificationRepositoryRuntime(
    async () => new NotificationRepository(await getDatabase()),
    seedDefaultOfficialNotifications,
  );
  const getNotificationRepository = notificationRuntime.getRepository;
  const initialization = createRuntimeInitialization(async () => {
    await settleInitialization([
      getFeaturedRepository(),
      getTemplateRepository(),
      getUserRepository(),
      getProjectRepository(),
      getWorkflowNodeResultRepository(),
      notificationRuntime.initialize(),
    ]);
  });
  const redis = getRedisClient({
    url: config.redisUrl,
    keyPrefix: 'lumen:studio:',
  });
  const cache = new JsonCache(redis);

  const homeQueries = createHomeQueryService({
    cache,
    featuredListSchema: HomeFeaturedItemRecordSchema.array(),
    templateListSchema: HomeWorkflowTemplateListRecordSchema,
    getFeaturedRepository,
    getTemplateRepository,
    tracePrefix: 'api',
  });
  const identityProvider = createIdentityProvider({
    authorizedParties: config.identityAuthorizedParties,
    jwtKey: config.identityJwtKey,
    secretKey: config.identitySecretKey,
  });
  const authenticatedUsers = createAuthenticatedUserService({
    getUserRepository,
    verifySessionToken: identityProvider.verifySessionToken,
  });
  const notifications = createNotificationService({
    getRepository: getNotificationRepository,
    tracePrefix: 'api',
  });
  const projectQueries = createProjectQueryService({
    cache,
    getRepository: getProjectRepository,
    projectListSchema: ProjectListRecordSchema.array(),
    tracePrefix: 'api',
  });
  const projectDetails = createProjectDetailQueryService<ProjectCanvas, ProjectRecord>({
    cache,
    getProjectRepository,
    getWorkflowNodeResultRepository,
    projectDetailSchema: ProjectRecordSchema,
    tracePrefix: 'api',
  });

  return {
    authenticatedUsers,
    homeQueries,
    initialize: initialization.initialize,
    notifications,
    projectDetails,
    projectQueries,
    async readiness(): Promise<ReadinessChecks> {
      const [mongo, workflowMongo] = await Promise.all([
        pingMongoDatabase(getDatabase),
        pingMongoDatabase(getWorkflowDatabase),
      ]);
      const checks: ReadinessChecks = {
        mongo,
        startup: initialization.isReady(),
        workflowMongo,
      };
      if (redis) {
        checks.redis = false;
        try {
          checks.redis = (await redis.ping()) === 'PONG';
        } catch {
          checks.redis = false;
        }
      }
      return checks;
    },
    async close() {
      const results = await Promise.allSettled([closeRedisClients(), closeMongoDatabases()]);
      const errors = results.flatMap((result) =>
        result.status === 'rejected' ? [result.reason] : [],
      );
      if (errors.length > 0) {
        throw new AggregateError(errors, 'Failed to close API persistence clients');
      }
    },
  };
}

export function createApiDatabaseLoaders(
  config: Pick<ApiConfig, 'mongoDb' | 'mongoUri' | 'workflowMongoDb'>,
  connect: typeof getMongoDatabase = getMongoDatabase,
) {
  return {
    getDatabase: memoizeAsync(() =>
      connect({
        uri: config.mongoUri,
        dbName: config.mongoDb,
        appName: 'lumen-api',
      }),
    ),
    getWorkflowDatabase: memoizeAsync(() =>
      connect({
        uri: config.mongoUri,
        dbName: config.workflowMongoDb,
        appName: 'lumen-api-workflow',
      }),
    ),
  };
}

async function pingMongoDatabase(
  getDatabase: () => ReturnType<typeof getMongoDatabase>,
): Promise<boolean> {
  try {
    const database = await getDatabase();
    await database.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

export interface IndexedNotificationRepository {
  ensureIndexes(): Promise<void>;
}

export interface ApiRuntimeInitializationRetryOptions {
  maxAttempts?: number;
  retryDelayMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}

export async function initializeApiRuntimeWithRetry(
  initialize: () => void | Promise<void>,
  options: ApiRuntimeInitializationRetryOptions = {},
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_API_RUNTIME_INITIALIZATION_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_API_RUNTIME_INITIALIZATION_RETRY_DELAY_MS;
  const wait = options.wait ?? waitForDelay;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('maxAttempts must be a positive integer');
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new RangeError('retryDelayMs must be a non-negative finite number');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await initialize();
      return;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      await wait(retryDelayMs);
    }
  }
}

export function createRuntimeInitialization(initializeDependencies: () => void | Promise<void>) {
  let ready = false;
  const initialize = memoizeAsync(async () => {
    ready = false;
    await initializeDependencies();
    ready = true;
  });

  return { initialize, isReady: () => ready };
}

export function createNotificationRepositoryRuntime<
  TRepository extends IndexedNotificationRepository,
>(
  createRepository: () => TRepository | Promise<TRepository>,
  seedRepository: (repository: TRepository) => void | Promise<void>,
) {
  let ready = false;
  const getRepository = memoizeAsync(async () => {
    const repository = await createRepository();
    await repository.ensureIndexes();
    return repository;
  });
  const initialize = memoizeAsync(async () => {
    ready = false;
    await seedRepository(await getRepository());
    ready = true;
  });

  return { getRepository, initialize, isReady: () => ready };
}

function memoizeAsync<T>(factory: () => Promise<T>): () => Promise<T> {
  let promise: Promise<T> | null = null;
  return () => {
    promise ??= factory().catch((error) => {
      promise = null;
      throw error;
    });
    return promise;
  };
}

function waitForDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function settleInitialization(operations: readonly Promise<unknown>[]): Promise<void> {
  const results = await Promise.allSettled(operations);
  const errors = results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : []));
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) {
    throw new AggregateError(errors, 'API runtime initialization failed');
  }
}
