export interface ApiConfig {
  host: string;
  mongoDb: string;
  mongoUri: string;
  port: number;
  redisUrl?: string;
  release: string;
}

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    host: env.API_HOST?.trim() || '127.0.0.1',
    mongoDb: env.MONGODB_DB?.trim() || 'lumen_app',
    mongoUri: env.MONGODB_URI?.trim() || '',
    port: readPort(env.API_PORT ?? env.PORT),
    redisUrl: env.REDIS_URL?.trim() || undefined,
    release: env.RELEASE_SHA?.trim() || env.GITHUB_SHA?.trim() || 'dev',
  };
}

function readPort(value: string | undefined): number {
  if (!value) return 3003;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('API_PORT must be an integer between 1 and 65535');
  }
  return port;
}
