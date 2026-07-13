import { serve } from '@hono/node-server';

import { createApiApp } from './app.js';
import { readApiConfig } from './config.js';

const config = readApiConfig();
const app = createApiApp({ release: config.release });

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
const shutdown = (signal: string) => {
  if (closing) return;
  closing = true;
  console.info('[lumen-api] shutting down', { signal });
  server.close((error) => {
    if (error) {
      console.error('[lumen-api] shutdown failed', { error });
      process.exitCode = 1;
    }
  });
};

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
