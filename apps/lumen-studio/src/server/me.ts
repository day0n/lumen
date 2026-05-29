import 'server-only';

import type { UserRecord } from '@lumen/db';

import { requireStudioUser } from './auth';

export interface CurrentUserResponse {
  user: UserRecord;
}

/**
 * Returns the current Lumen user (upserts to Mongo if first call after sign-up).
 * Throws UnauthorizedError when not signed in.
 */
export async function getCurrentUser(): Promise<CurrentUserResponse> {
  const user = await requireStudioUser();
  return { user };
}
