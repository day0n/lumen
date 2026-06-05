import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';

import { verifyToken } from '@clerk/backend';

import {
  AUTH_BYPASS_CLERK_USER_ID,
  AUTH_BYPASS_TOKEN,
  isAuthBypassEnabled,
} from '@/lib/auth-bypass';

import { getUserRepository } from '../db';
import { logger } from '../logger';

export interface FlowAuthContext {
  userId: string;
  clerkUserId: string;
  sessionId?: string;
}

export async function authenticateFlowUpgrade(
  req: IncomingMessage,
): Promise<FlowAuthContext | null> {
  const token = readFlowToken(req);

  if (isAuthBypassEnabled() && (!token || token === AUTH_BYPASS_TOKEN)) {
    const repository = await getUserRepository();
    const user = await repository.upsertFromClerk({
      clerkUserId: AUTH_BYPASS_CLERK_USER_ID,
      email: 'tester@lumen.local',
      fullName: 'Lumen Test User',
    });
    return {
      userId: user.id,
      clerkUserId: AUTH_BYPASS_CLERK_USER_ID,
      sessionId: 'auth-bypass',
    };
  }

  if (!token) return null;

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) {
    logger.warn('CLERK_SECRET_KEY not configured; rejecting ws/flow upgrade');
    return null;
  }

  try {
    const payload = await verifyToken(token, { secretKey });
    const clerkUserId = typeof payload.sub === 'string' ? payload.sub : '';
    if (!clerkUserId) return null;

    const repository = await getUserRepository();
    const cachedUser = await repository.getByClerkId(clerkUserId);
    const user = cachedUser ?? (await repository.upsertFromClerk({ clerkUserId }));
    const sessionId = typeof payload.sid === 'string' ? payload.sid : undefined;

    return {
      userId: user.id,
      clerkUserId,
      sessionId,
    };
  } catch (err) {
    logger.warn({ err }, 'ws/flow token verification failed');
    return null;
  }
}

export function rejectUnauthorizedUpgrade(socket: Duplex): void {
  socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
  socket.destroy();
}

function readFlowToken(req: IncomingMessage): string | null {
  const protocolToken = readTokenFromWebSocketProtocols(req);
  if (protocolToken) return protocolToken;

  const url = new URL(req.url ?? '/', 'http://localhost');
  const queryToken = url.searchParams.get('token')?.trim();
  if (queryToken) return queryToken;

  const authorization = req.headers.authorization;
  const headerValue = Array.isArray(authorization) ? authorization[0] : authorization;
  const match = headerValue?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function readTokenFromWebSocketProtocols(req: IncomingMessage): string | null {
  const protocolHeader = req.headers['sec-websocket-protocol'];
  const values = Array.isArray(protocolHeader) ? protocolHeader : [protocolHeader];

  for (const value of values) {
    for (const protocol of value?.split(',') ?? []) {
      const trimmed = protocol.trim();
      if (trimmed.startsWith('clerk.')) {
        return trimmed.slice('clerk.'.length).trim() || null;
      }
    }
  }

  return null;
}
