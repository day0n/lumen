import { apiFailure } from '@lumen/backend';
import { Hono } from 'hono';

import type { ApiEnv } from './http/context-middleware.js';
import { requestContextMiddleware } from './http/context-middleware.js';

export type ReadinessChecks = Record<string, boolean>;

export interface CreateApiAppOptions {
  release?: string;
  readiness?: () => Promise<ReadinessChecks> | ReadinessChecks;
}

export function createApiApp(options: CreateApiAppOptions = {}) {
  const release = options.release ?? 'dev';
  const readiness = options.readiness ?? (() => ({ bootstrap: true }));
  const app = new Hono<ApiEnv>();

  app.use('*', requestContextMiddleware());

  app.get('/healthz', (context) =>
    context.json({
      ok: true as const,
      service: 'lumen-api',
      release,
      ts: Date.now(),
    }),
  );

  app.get('/readyz', async (context) => {
    let checks: ReadinessChecks;
    try {
      checks = await readiness();
    } catch {
      checks = { bootstrap: false };
    }
    const ready = Object.values(checks).length > 0 && Object.values(checks).every(Boolean);
    return context.json(
      {
        ok: ready,
        service: 'lumen-api',
        release,
        checks,
        ts: Date.now(),
      },
      ready ? 200 : 503,
    );
  });

  app.notFound((context) => context.json(apiFailure('Not found', undefined, 'NOT_FOUND'), 404));

  app.onError((error, context) => {
    const requestId = context.get('requestContext')?.requestId;
    console.error('[lumen-api] unhandled request error', { requestId, error });
    return context.json(apiFailure('Internal server error', undefined, 'INTERNAL_ERROR'), 500);
  });

  return app;
}
