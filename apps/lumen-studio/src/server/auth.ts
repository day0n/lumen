import 'server-only';

import { verifyToken } from '@clerk/backend';
import { auth, currentUser } from '@clerk/nextjs/server';
import type { UserRecord } from '@lumen/db';
import { headers } from 'next/headers';

import { getUserRepository } from './db';

export class UnauthorizedError extends Error {
  constructor(message = 'Please sign in first') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

type StudioAuthOptions = {
  sessionClockSkewInMs?: number;
};

/**
 * Resolve the Clerk userId for the current request, or null if signed out.
 * Cheap — only reads the auth cookie/JWT.
 */
export async function getClerkUserId(
  request?: Request,
  options: StudioAuthOptions = {},
): Promise<string | null> {
  const { userId } = await auth();
  return (
    userId ?? (await getRequestClerkUserId(request, options)) ?? (await getBearerClerkUserId())
  );
}

/**
 * Require a signed-in Clerk user, sync to Mongo (upsert), and return the
 * Lumen UserRecord. Throws UnauthorizedError when not signed in.
 *
 * Use this in API routes and server actions that need an owner_id.
 */
export async function requireStudioUser(
  request?: Request,
  options: StudioAuthOptions = {},
): Promise<UserRecord> {
  const { userId } = await auth();
  const clerkUserId =
    userId ?? (await getRequestClerkUserId(request, options)) ?? (await getBearerClerkUserId());
  if (!clerkUserId) {
    throw new UnauthorizedError();
  }

  const repository = await getUserRepository();
  const cachedUser = await repository.getByClerkId(clerkUserId);
  if (cachedUser) return cachedUser;

  if (!userId) {
    return repository.upsertFromClerk({ clerkUserId });
  }

  const clerkUser = await currentUser();
  if (!clerkUser) {
    return repository.upsertFromClerk({ clerkUserId });
  }

  const primaryEmail = clerkUser.emailAddresses.find(
    (e) => e.id === clerkUser.primaryEmailAddressId,
  )?.emailAddress;

  const fullName = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(' ').trim();

  return repository.upsertFromClerk({
    clerkUserId: clerkUser.id,
    email: primaryEmail,
    firstName: clerkUser.firstName ?? undefined,
    lastName: clerkUser.lastName ?? undefined,
    fullName: fullName.length > 0 ? fullName : undefined,
    imageUrl: clerkUser.imageUrl,
  });
}

async function getBearerClerkUserId(): Promise<string | null> {
  const token = await readBearerToken();
  return verifyClerkSessionToken(token);
}

async function getRequestClerkUserId(
  request: Request | undefined,
  options: StudioAuthOptions,
): Promise<string | null> {
  if (!request) return null;
  const token = readBearerTokenFromHeaders(request.headers) ?? readSessionCookie(request.headers);
  return verifyClerkSessionToken(token, options);
}

async function verifyClerkSessionToken(
  token: string | null,
  options: StudioAuthOptions = {},
): Promise<string | null> {
  if (!token) return null;

  const secretKey = process.env.CLERK_SECRET_KEY;
  if (!secretKey) return null;

  try {
    const payload = await verifyToken(token, {
      secretKey,
      clockSkewInMs: options.sessionClockSkewInMs,
    });
    return typeof payload.sub === 'string' && payload.sub ? payload.sub : null;
  } catch {
    return null;
  }
}

async function readBearerToken(): Promise<string | null> {
  const authorization = (await headers()).get('authorization');
  return readBearerTokenFromValue(authorization);
}

function readBearerTokenFromHeaders(headers: Headers): string | null {
  return readBearerTokenFromValue(headers.get('authorization'));
}

function readBearerTokenFromValue(authorization: string | null): string | null {
  const match = authorization?.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

function readSessionCookie(headers: Headers): string | null {
  const cookieHeader = headers.get('cookie');
  if (!cookieHeader) return null;

  for (const cookie of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = cookie.trim().split('=');
    if (!rawName || rawValue.length === 0) continue;
    if (rawName !== '__session' && !rawName.startsWith('__session_')) continue;
    const value = rawValue.join('=').trim();
    if (!value) continue;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }

  return null;
}
