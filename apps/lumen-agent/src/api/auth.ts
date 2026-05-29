import type { Context, Next } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import { logger } from '../observability/logger.js';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

function getJwks(issuer: string) {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  }
  return jwks;
}

export interface AuthUser {
  userId: string;
  sessionId?: string;
}

export function clerkAuth(opts: { issuer: string; skipPaths?: string[] }) {
  const skipSet = new Set(opts.skipPaths ?? ['/healthz']);

  return async (c: Context, next: Next) => {
    if (skipSet.has(c.req.path)) {
      return next();
    }

    const authHeader = c.req.header('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return c.json(
        { error: 'unauthorized', message: 'Missing or invalid Authorization header' },
        401,
      );
    }

    const token = authHeader.slice(7);
    try {
      const { payload } = await jwtVerify(token, getJwks(opts.issuer), {
        issuer: opts.issuer,
      });

      const userId = payload.sub;
      if (!userId) {
        return c.json({ error: 'unauthorized', message: 'Token missing sub claim' }, 401);
      }

      c.set('authUser', {
        userId,
        sessionId: payload.sid as string | undefined,
      } satisfies AuthUser);
      return next();
    } catch (err) {
      logger.warn({ err }, 'JWT verification failed');
      return c.json({ error: 'unauthorized', message: 'Invalid token' }, 401);
    }
  };
}
