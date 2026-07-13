import { serve } from '@hono/node-server';

import { createApiApp } from './app.js';
import { readApiConfig } from './config.js';
import { createApiRuntime } from './runtime.js';

const config = readApiConfig();
const runtime = createApiRuntime(config);
const app = createApiApp({
  homeQueries: runtime.homeQueries,
  readiness: runtime.readiness,
  release: config.release,
  requiredReadinessChecks: ['mongo'],
});

const server = serve({
  fetch: app.fetch,
  hostname: config.host,
  port: config.port,
});

console.info('[lumen-api] listening', {
  host: config.host,
  port: config.port,
  release: config.release,
});

let closing = false;
const shutdown = async (signal: string) => {
  if (closing) return;
  closing = true;
  console.info('[lumen-api] shutting down', { signal });
  await new Promise<void>((resolve) => {
    server.close((error) => {
      if (error) {
        console.error('[lumen-api] shutdown failed', { error });
        process.exitCode = 1;
      }
      resolve();
    });
  });
  await runtime.close();
};

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
