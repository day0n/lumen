export interface ApiConfig {
  host: string;
  port: number;
  release: string;
}

export function readApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  return {
    host: env.API_HOST?.trim() || '127.0.0.1',
    port: readPort(env.API_PORT ?? env.PORT),
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
