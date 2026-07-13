import { apiFailure } from '@lumen/backend';
import { Hono } from 'hono';

import type { ApiEnv } from './http/context-middleware.js';
import { requestContextMiddleware } from './http/context-middleware.js';

export type ReadinessChecks = Record<string, boolean>;

export interface HomeQueries {
  listFeatured(locale: 'en' | 'zh'): Promise<unknown[]>;
  listTemplates(locale: 'en' | 'zh'): Promise<unknown>;
}

export interface CreateApiAppOptions {
  homeQueries?: HomeQueries;
  release?: string;
  readiness?: () => Promise<ReadinessChecks> | ReadinessChecks;
  requiredReadinessChecks?: readonly string[];
}

export function createApiApp(options: CreateApiAppOptions = {}) {
  const release = options.release ?? 'dev';
  const readiness = options.readiness ?? (() => ({ bootstrap: true }));
  const requiredReadinessChecks = options.requiredReadinessChecks;
  const app = new Hono<ApiEnv>();

  app.use('*', requestContextMiddleware());
  app.use('*', async (context, next) => {
    await next();
    context.header('x-lumen-release', release);
  });

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
    const ready = requiredReadinessChecks
      ? requiredReadinessChecks.length > 0 &&
        requiredReadinessChecks.every((name) => checks[name] === true)
      : Object.values(checks).length > 0 && Object.values(checks).every(Boolean);
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

  app.get('/api/home/featured', async (context) => {
    const requestContext = context.get('requestContext');
    if (!options.homeQueries) {
      return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 503);
    }
    try {
      const items = await options.homeQueries.listFeatured(requestContext.locale);
      return context.json({ ok: true as const, data: { items } });
    } catch (error) {
      logRouteError('GET /api/home/featured', requestContext.requestId, error);
      return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 500);
    }
  });

  app.get('/api/home/templates', async (context) => {
    const requestContext = context.get('requestContext');
    if (!options.homeQueries) {
      return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 503);
    }
    try {
      const templates = await options.homeQueries.listTemplates(requestContext.locale);
      return context.json({ ok: true as const, data: templates });
    } catch (error) {
      logRouteError('GET /api/home/templates', requestContext.requestId, error);
      return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 500);
    }
  });

  app.notFound((context) => context.json(apiFailure('Not found', undefined, 'NOT_FOUND'), 404));

  app.onError((error, context) => {
    const requestId = context.get('requestContext')?.requestId;
    console.error('[lumen-api] unhandled request error', { requestId, error });
    return context.json(apiFailure('Internal server error', undefined, 'INTERNAL_ERROR'), 500);
  });

  return app;
}

function internalErrorMessage(locale: 'en' | 'zh') {
  return locale === 'zh' ? '服务暂时不可用' : 'Internal server error';
}

function logRouteError(route: string, requestId: string, error: unknown) {
  console.error('[lumen-api] route failed', { route, requestId, error });
}
