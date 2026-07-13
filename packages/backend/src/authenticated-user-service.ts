import type { RequestActor } from './request-context.js';

export interface SessionIdentity {
  clerkUserId: string;
  sessionId?: string;
}

export interface UserRecordPort {
  id: string;
  clerkUserId: string;
}

export interface UserRepositoryPort<TUser extends UserRecordPort> {
  getByClerkId(clerkUserId: string): Promise<TUser | null>;
}

export interface AuthenticatedUser<TUser extends UserRecordPort> {
  actor: RequestActor;
  user: TUser;
}

export interface AuthenticatedUserService<TUser extends UserRecordPort> {
  requireUser(token: string | null | undefined): Promise<AuthenticatedUser<TUser>>;
}

export interface CreateAuthenticatedUserServiceOptions<TUser extends UserRecordPort> {
  verifySessionToken: (token: string) => SessionIdentity | null | Promise<SessionIdentity | null>;
  getUserRepository: () => UserRepositoryPort<TUser> | Promise<UserRepositoryPort<TUser>>;
  provisionUser?: (
    identity: SessionIdentity,
    repository: UserRepositoryPort<TUser>,
  ) => TUser | Promise<TUser>;
}

export class UnauthorizedError extends Error {
  constructor(options?: ErrorOptions) {
    super('Authentication required', options);
    this.name = 'UnauthorizedError';
  }
}

export class UserProvisioningRequiredError extends Error {
  constructor() {
    super('Authenticated user requires provisioning');
    this.name = 'UserProvisioningRequiredError';
  }
}

export class UserIdentityMismatchError extends Error {
  constructor() {
    super('Provisioned user identity does not match the verified session');
    this.name = 'UserIdentityMismatchError';
  }
}

export function createAuthenticatedUserService<TUser extends UserRecordPort>(
  options: CreateAuthenticatedUserServiceOptions<TUser>,
): AuthenticatedUserService<TUser> {
  return {
    async requireUser(rawToken) {
      const token = rawToken?.trim();
      if (!token) {
        throw new UnauthorizedError();
      }

      const untrustedIdentity = await options.verifySessionToken(token);

      if (
        !untrustedIdentity ||
        typeof untrustedIdentity.clerkUserId !== 'string' ||
        !untrustedIdentity.clerkUserId.trim()
      ) {
        throw new UnauthorizedError();
      }

      const clerkUserId = untrustedIdentity.clerkUserId.trim();
      const sessionId = untrustedIdentity.sessionId?.trim();
      const identity: SessionIdentity = {
        clerkUserId,
        ...(sessionId ? { sessionId } : {}),
      };

      const repository = await options.getUserRepository();
      let user = await repository.getByClerkId(clerkUserId);

      if (user && user.clerkUserId !== clerkUserId) {
        throw new UserIdentityMismatchError();
      }

      if (!user) {
        if (!options.provisionUser) {
          throw new UserProvisioningRequiredError();
        }

        user = await options.provisionUser(identity, repository);
        if (!user || user.clerkUserId !== clerkUserId) {
          throw new UserIdentityMismatchError();
        }
      }

      return {
        actor: {
          userId: user.id,
          clerkUserId,
          ...(sessionId ? { sessionId } : {}),
        },
        user,
      };
    },
  };
}
