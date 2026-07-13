export interface ApiConfig {
  environment: 'development' | 'production' | 'test';
  host: string;
  mongoDb: string;
  mongoUri: string;
  port: number;
  readinessTimeoutMs: number;
  redisUrl?: string;
  release: string;
  shutdownTimeoutMs: number;
}

export const DEFAULT_API_READINESS_TIMEOUT_MS = 2_000;
export const DEFAULT_API_SHUTDOWN_TIMEOUT_MS = 10_000;
export const MAX_TIMER_TIMEOUT_MS = 2_147_483_647;

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const environment = readEnvironment(env.NODE_ENV);
  const mongoUri = env.MONGODB_URI?.trim() || '';
  const release = env.RELEASE_SHA?.trim() || env.GITHUB_SHA?.trim() || 'dev';

  if (environment === 'production') {
    if (!mongoUri) {
      throw new Error('MONGODB_URI is required in production');
    }
    if (!isFullReleaseSha(release)) {
      throw new Error('RELEASE_SHA or GITHUB_SHA must be a full commit SHA in production');
    }
  }

  return {
    environment,
    host: env.API_HOST?.trim() || '127.0.0.1',
    mongoDb: env.MONGODB_DB?.trim() || 'lumen_app',
    mongoUri,
    port: readPort(env.API_PORT?.trim() || env.PORT?.trim()),
    readinessTimeoutMs: readTimeout(
      'API_READINESS_TIMEOUT_MS',
      env.API_READINESS_TIMEOUT_MS,
      DEFAULT_API_READINESS_TIMEOUT_MS,
    ),
    redisUrl: env.REDIS_URL?.trim() || undefined,
    release,
    shutdownTimeoutMs: readTimeout(
      'API_SHUTDOWN_TIMEOUT_MS',
      env.API_SHUTDOWN_TIMEOUT_MS,
      DEFAULT_API_SHUTDOWN_TIMEOUT_MS,
    ),
  };
}

function readEnvironment(value: string | undefined): ApiConfig['environment'] {
  const environment = value?.trim() || 'development';
  if (!['development', 'production', 'test'].includes(environment)) {
    throw new Error('NODE_ENV must be development, production, or test');
  }
  return environment as ApiConfig['environment'];
}

function readPort(value: string | undefined): number {
  if (!value) return 3003;
  const port = Number(value);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }
  return port;
}

function readTimeout(name: string, value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const timeout = Number(value);
  if (!Number.isSafeInteger(timeout) || timeout < 1 || timeout > MAX_TIMER_TIMEOUT_MS) {
    throw new Error(`${name} must be an integer between 1 and ${MAX_TIMER_TIMEOUT_MS}`);
  }
  return timeout;
}

function isFullReleaseSha(value: string): boolean {
  return /^[0-9a-f]{40}$/i.test(value);
}
