import { randomUUID } from 'node:crypto';
import type { RequestContext } from '@lumen/backend';
import { createMiddleware } from 'hono/factory';

import { resolveRequestLocale } from './locale.js';

const SAFE_REQUEST_ID = /^[A-Za-z0-9._:-]{1,128}$/;

export interface ApiVariables {
  requestContext: RequestContext;
}

export interface ApiEnv {
  Variables: ApiVariables;
}

export function requestContextMiddleware() {
  return createMiddleware<ApiEnv>(async (context, next) => {
    const suppliedRequestId = context.req.header('x-request-id')?.trim();
    const requestId =
      suppliedRequestId && SAFE_REQUEST_ID.test(suppliedRequestId)
        ? suppliedRequestId
        : randomUUID();

    context.set('requestContext', {
      actor: null,
      locale: resolveRequestLocale(context.req.raw),
      requestId,
    });
    context.header('x-request-id', requestId);

    await next();

    context.header('x-request-id', requestId);
  });
}
