import {
  type NotificationSeedRepositoryPort,
  seedDefaultOfficialNotifications,
} from '@lumen/backend';

import { createRepositoryLoader } from './repository-loader';

type MaybePromise<T> = T | Promise<T>;

export interface IndexedNotificationRepository {
  ensureIndexes(): Promise<void>;
}

export interface NotificationSeedStartupOptions {
  getRepository: () => MaybePromise<NotificationSeedRepositoryPort>;
  maxAttempts?: number;
  retryDelayMs?: number;
  wait?: (delayMs: number) => Promise<void>;
}

export type StartupWarmupTask = () => MaybePromise<unknown>;

const DEFAULT_SEED_MAX_ATTEMPTS = 3;
const DEFAULT_SEED_RETRY_DELAY_MS = 250;

export function createNotificationRepositoryLoader<
  TRepository extends IndexedNotificationRepository,
>(factory: () => MaybePromise<TRepository>): () => Promise<TRepository> {
  return createRepositoryLoader(async () => {
    const repository = await factory();
    await repository.ensureIndexes();
    return repository;
  });
}

export async function initializeDefaultOfficialNotifications(
  options: NotificationSeedStartupOptions,
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? DEFAULT_SEED_MAX_ATTEMPTS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_SEED_RETRY_DELAY_MS;
  const wait = options.wait ?? waitForDelay;

  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
    throw new RangeError('maxAttempts must be a positive integer');
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new RangeError('retryDelayMs must be a non-negative finite number');
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      const repository = await options.getRepository();
      await seedDefaultOfficialNotifications(repository);
      return;
    } catch (error) {
      if (attempt === maxAttempts) throw error;
      await wait(retryDelayMs);
    }
  }
}

export async function runStartupWarmups(tasks: readonly StartupWarmupTask[]): Promise<void> {
  const results = await Promise.allSettled(
    tasks.map((task) => Promise.resolve().then(() => task())),
  );
  const failures = results.flatMap((result) =>
    result.status === 'rejected' ? [result.reason] : [],
  );

  if (failures.length > 0) {
    throw new AggregateError(failures, `${failures.length} startup warmup task(s) failed`);
  }
}

function waitForDelay(delayMs: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}
