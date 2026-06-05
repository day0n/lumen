import { randomUUID } from 'node:crypto';
import type { Context, Next } from 'hono';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import { logger } from '../../../platform/logger.js';
import { getStudioMongo } from '../../outbound/persistence/mongo.js';

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

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
