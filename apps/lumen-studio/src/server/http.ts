import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { UnauthorizedError } from './auth';

export function okJson<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function failJson(message: string, status = 500, detail?: unknown) {
  return NextResponse.json({ ok: false, error: { message, detail } }, { status });
}

export function routeError(error: unknown) {
  if (error instanceof UnauthorizedError) {
    return failJson(error.message, 401);
  }

  if (error instanceof ZodError) {
    return failJson('请求数据不符合约束', 400, error.flatten());
  }

  Sentry.captureException(error);
  const message = error instanceof Error ? error.message : 'Internal server error';
  return failJson(message, 500);
}

export async function readJson(request: Request): Promise<unknown> {
  const text = await request.text();
  if (!text.trim()) return {};
  return JSON.parse(text) as unknown;
}

export function withApiRouteSpan<Args extends unknown[]>(
  route: string,
  handler: (...args: Args) => Response | Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) =>
    Sentry.startSpan(
      {
        name: route,
        op: 'http.server',
        forceTransaction: true,
        attributes: {
          'http.route': route,
          'lumen.surface': 'studio-api',
        },
      },
      async (span) => {
        const startedAt = performance.now();
        try {
          const response = await handler(...args);
          span.setAttribute('http.response.status_code', response.status);
          span.setAttribute('lumen.duration_ms', Math.round(performance.now() - startedAt));
          return response;
        } catch (error) {
          span.setAttribute('lumen.duration_ms', Math.round(performance.now() - startedAt));
          span.setStatus({ code: 2, message: error instanceof Error ? error.message : 'error' });
          throw error;
        }
      },
    );
}
