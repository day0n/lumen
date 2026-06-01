import 'server-only';

import * as Sentry from '@sentry/nextjs';
import { NextResponse } from 'next/server';
import { ZodError } from 'zod';

import { translate } from '@/i18n/messages';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/routing';
import { UnauthorizedError } from './auth';

export function okJson<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function failJson(message: string, status = 500, detail?: unknown) {
  return NextResponse.json({ ok: false, error: { message, detail } }, { status });
}

export function routeError(error: unknown, locale: Locale = DEFAULT_LOCALE) {
  if (error instanceof UnauthorizedError) {
    return failJson(translate(locale, 'api.unauthorized'), 401);
  }

  if (error instanceof ZodError) {
    return failJson(translate(locale, 'api.invalidRequest'), 400, error.flatten());
  }

  Sentry.captureException(error);
  return failJson(translate(locale, 'api.internalError'), 500);
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
          const durationMs = Math.round(performance.now() - startedAt);
          recordApiRouteTelemetry(route, durationMs, response.status);
          span.setAttribute('http.response.status_code', response.status);
          span.setAttribute('lumen.duration_ms', durationMs);
          if (response.status >= 500) {
            span.setStatus({ code: 2, message: `HTTP ${response.status}` });
          }
          return response;
        } catch (error) {
          const durationMs = Math.round(performance.now() - startedAt);
          recordApiRouteTelemetry(route, durationMs, 500);
          span.setAttribute('lumen.duration_ms', durationMs);
          span.setStatus({ code: 2, message: error instanceof Error ? error.message : 'error' });
          throw error;
        }
      },
    );
}

function recordApiRouteTelemetry(route: string, durationMs: number, statusCode: number) {
  const [method = 'UNKNOWN', ...routeParts] = route.split(' ');
  const routePath = routeParts.join(' ') || route;
  Sentry.metrics.distribution('lumen.studio.api.duration', durationMs, {
    unit: 'millisecond',
    attributes: {
      route,
      method,
      path: routePath,
      status_code: statusCode,
    },
  });
}
