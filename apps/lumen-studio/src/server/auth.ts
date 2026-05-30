import 'server-only';

import { auth, currentUser } from '@clerk/nextjs/server';
import type { UserRecord } from '@lumen/db';

import { getUserRepository } from './db';

export class UnauthorizedError extends Error {
  constructor(message = '请先登录') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Resolve the Clerk userId for the current request, or null if signed out.
 * Cheap — only reads the auth cookie/JWT.
 */
export async function getClerkUserId(): Promise<string | null> {
  const { userId } = await auth();
  return userId;
}

/**
 * Require a signed-in Clerk user, sync to Mongo (upsert), and return the
 * Lumen UserRecord. Throws UnauthorizedError when not signed in.
 *
 * Use this in API routes and server actions that need an owner_id.
 */
export async function requireStudioUser(): Promise<UserRecord> {
  const { userId } = await auth();
  if (!userId) {
    throw new UnauthorizedError();
  }

  const repository = await getUserRepository();
  const cachedUser = await repository.getByClerkId(userId);
  if (cachedUser) return cachedUser;

  const clerkUser = await currentUser();
  if (!clerkUser) {
    throw new UnauthorizedError();
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
