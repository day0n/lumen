import { randomUUID } from 'node:crypto';
import type { Context, Next } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import { logger } from '../../../platform/logger.js';
import { getStudioMongo } from '../../outbound/persistence/mongo.js';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
const AUTH_BYPASS_CLERK_USER_ID = 'lumen-public-test-user';
const AUTH_BYPASS_TOKEN = 'lumen-auth-bypass';

function getJwks(issuer: string) {
  if (!jwks) {
    jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
  }
  return jwks;
}

export interface AuthUser {
  clerkUserId: string;
  userId: string;
  sessionId?: string;
}

interface StudioUserDocument {
  _id: string;
  clerk_user_id: string;
  created_at: Date;
  updated_at: Date;
  last_seen_at?: Date;
}

async function resolveStudioUserId(clerkUserId: string): Promise<string> {
  const db = await getStudioMongo();
  const now = new Date();
  const document = await db.collection<StudioUserDocument>('studio_users').findOneAndUpdate(
    { clerk_user_id: clerkUserId },
    {
      $set: {
        updated_at: now,
        last_seen_at: now,
      },
      $setOnInsert: {
        _id: randomUUID(),
        clerk_user_id: clerkUserId,
        created_at: now,
      },
    },
    { upsert: true, returnDocument: 'after' },
  );

  if (!document) {
    throw new Error(`failed to resolve Studio user for Clerk user ${clerkUserId}`);
  }
  return document._id;
}

export function clerkAuth(opts: { issuer: string; skipPaths?: string[] }) {
  const skipSet = new Set(opts.skipPaths ?? ['/healthz']);

  return async (c: Context, next: Next) => {
    if (skipSet.has(c.req.path)) {
      return next();
    }

    const authHeader = c.req.header('authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (isAuthBypassEnabled() && (!token || token === AUTH_BYPASS_TOKEN)) {
      const userId = await resolveStudioUserId(AUTH_BYPASS_CLERK_USER_ID);
      c.set('authUser', {
        clerkUserId: AUTH_BYPASS_CLERK_USER_ID,
        userId,
        sessionId: 'auth-bypass',
      } satisfies AuthUser);
      return next();
    }

    if (!token) {
      return c.json(
        { error: 'unauthorized', message: 'Missing or invalid Authorization header' },
        401,
      );
    }

    try {
      const { payload } = await jwtVerify(token, getJwks(opts.issuer), {
        issuer: opts.issuer,
      });

      const clerkUserId = payload.sub;
      if (!clerkUserId) {
        return c.json({ error: 'unauthorized', message: 'Token missing sub claim' }, 401);
      }

      const userId = await resolveStudioUserId(clerkUserId);

      c.set('authUser', {
        clerkUserId,
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

function isAuthBypassEnabled(): boolean {
  return (
    isTruthy(process.env.LUMEN_AUTH_BYPASS) || isTruthy(process.env.NEXT_PUBLIC_LUMEN_AUTH_BYPASS)
  );
}

function isTruthy(value: string | undefined): boolean {
  if (!value) return false;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}
