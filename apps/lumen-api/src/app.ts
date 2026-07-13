import {
  type AuthenticatedUser,
  UnauthorizedError,
  UserProvisioningRequiredError,
  type UserRecordPort,
  apiFailure,
  apiSuccess,
} from '@lumen/backend';
import { Hono } from 'hono';

import { DEFAULT_API_READINESS_TIMEOUT_MS, MAX_TIMER_TIMEOUT_MS } from './config.js';
import type { ApiEnv } from './http/context-middleware.js';
import { requestContextMiddleware } from './http/context-middleware.js';
import { readSessionToken } from './http/session-token.js';

export type ReadinessChecks = Record<string, boolean>;

export interface HomeQueries {
  listFeatured(locale: 'en' | 'zh'): Promise<unknown[]>;
  listTemplates(locale: 'en' | 'zh'): Promise<unknown>;
}

export interface AuthenticatedUsers<TUser extends UserRecordPort = UserRecordPort> {
  requireUser(token: string | null | undefined): Promise<AuthenticatedUser<TUser>>;
}

export interface CreateApiAppOptions {
  authenticatedUsers?: AuthenticatedUsers;
  homeQueries?: HomeQueries;
  release?: string;
  readiness?: () => Promise<ReadinessChecks> | ReadinessChecks;
  readinessTimeoutMs?: number;
  requiredReadinessChecks?: readonly string[];
}

export function createApiApp(options: CreateApiAppOptions = {}) {
  const release = options.release ?? 'dev';
  const readiness = options.readiness ?? (() => ({ bootstrap: true }));
  const readinessTimeoutMs = readPositiveTimeout(
    options.readinessTimeoutMs ?? DEFAULT_API_READINESS_TIMEOUT_MS,
  );
  const requiredReadinessChecks = options.requiredReadinessChecks;
  const app = new Hono<ApiEnv>();

  app.use('*', requestContextMiddleware());
  app.use('*', async (context, next) => {
    await next();
    context.header('x-lumen-release', release);
  });

  app.get('/healthz', (context) => {
    context.header('cache-control', 'no-store');
    return context.json({
      ok: true as const,
      service: 'lumen-api',
      release,
      ts: Date.now(),
    });
  });

  app.get('/readyz', async (context) => {
    context.header('cache-control', 'no-store');
    let checks: ReadinessChecks;
    try {
      checks = await readinessBeforeDeadline(readiness, readinessTimeoutMs);
    } catch {
      checks = { readinessExecution: false };
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

  app.get('/api/me', async (context) => {
    context.header('cache-control', 'private, no-store');
    const requestContext = context.get('requestContext');
    if (!options.authenticatedUsers) {
      return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 503);
    }

    try {
      const authenticated = await options.authenticatedUsers.requireUser(
        readSessionToken(context.req.raw),
      );
      requestContext.actor = authenticated.actor;
      return context.json(apiSuccess({ user: authenticated.user }));
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return context.json(apiFailure(unauthorizedMessage(requestContext.locale)), 401);
      }
      if (error instanceof UserProvisioningRequiredError) {
        return context.json(
          apiFailure(
            internalErrorMessage(requestContext.locale),
            undefined,
            'USER_PROVISIONING_REQUIRED',
          ),
          503,
        );
      }
      logRouteError('GET /api/me', requestContext.requestId, error);
      return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 500);
    }
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

function unauthorizedMessage(locale: 'en' | 'zh') {
  return locale === 'zh' ? '请先登录' : 'Please sign in first';
}

function logRouteError(route: string, requestId: string, error: unknown) {
  console.error('[lumen-api] route failed', { route, requestId, error });
}

function readPositiveTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMER_TIMEOUT_MS) {
    throw new Error(`readinessTimeoutMs must be an integer between 1 and ${MAX_TIMER_TIMEOUT_MS}`);
  }
  return value;
}

async function readinessBeforeDeadline(
  readiness: () => Promise<ReadinessChecks> | ReadinessChecks,
  timeoutMs: number,
): Promise<ReadinessChecks> {
  const deadline = Symbol('readiness-deadline');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(readiness),
      new Promise<typeof deadline>((resolve) => {
        timer = setTimeout(() => resolve(deadline), timeoutMs);
      }),
    ]);
    return result === deadline ? { readinessDeadline: false } : result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
