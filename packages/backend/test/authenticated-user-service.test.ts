import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type SessionIdentity,
  UnauthorizedError,
  UserIdentityMismatchError,
  UserProvisioningRequiredError,
  type UserRecordPort,
  type UserRepositoryPort,
  createAuthenticatedUserService,
} from '../src/authenticated-user-service.ts';

interface TestUser extends UserRecordPort {
  email: string;
}

const identity: SessionIdentity = {
  clerkUserId: 'user-1',
  sessionId: 'session-1',
};

const user: TestUser = {
  id: 'local-user-1',
  clerkUserId: 'user-1',
  email: 'user@example.com',
};

function createRepository(foundUser: TestUser | null): UserRepositoryPort<TestUser> {
  return {
    async getByClerkId() {
      return foundUser;
    },
  };
}

test('missing and empty tokens are unauthorized without invoking verification', async () => {
  let verificationCalls = 0;
  const service = createAuthenticatedUserService({
    verifySessionToken: async () => {
      verificationCalls += 1;
      return identity;
    },
    getUserRepository: async () => createRepository(user),
  });

  await assert.rejects(service.requireUser(null), UnauthorizedError);
  await assert.rejects(service.requireUser(undefined), UnauthorizedError);
  await assert.rejects(service.requireUser('   '), UnauthorizedError);
  assert.equal(verificationCalls, 0);
});

test('invalid identities are unauthorized and verifier failures remain operational errors', async () => {
  const rejectedService = createAuthenticatedUserService({
    verifySessionToken: async () => null,
    getUserRepository: async () => createRepository(user),
  });
  const malformedService = createAuthenticatedUserService({
    verifySessionToken: async () => ({ clerkUserId: '   ' }),
    getUserRepository: async () => createRepository(user),
  });
  const verificationError = new Error('verification failed');
  const failedService = createAuthenticatedUserService({
    verifySessionToken: async () => {
      throw verificationError;
    },
    getUserRepository: async () => createRepository(user),
  });

  await assert.rejects(rejectedService.requireUser('token'), UnauthorizedError);
  await assert.rejects(malformedService.requireUser('token'), UnauthorizedError);
  await assert.rejects(failedService.requireUser('token'), (error: unknown) => {
    assert.equal(error, verificationError);
    return true;
  });
});

test('an existing user produces the actor from the verified identity', async () => {
  const repository = createRepository(user);
  const verifiedTokens: string[] = [];
  const lookedUpIds: string[] = [];
  repository.getByClerkId = async (clerkUserId) => {
    lookedUpIds.push(clerkUserId);
    return user;
  };
  const service = createAuthenticatedUserService({
    verifySessionToken: async (token) => {
      verifiedTokens.push(token);
      return { clerkUserId: ' user-1 ', sessionId: ' session-1 ' };
    },
    getUserRepository: async () => repository,
  });

  assert.deepEqual(await service.requireUser(' token '), {
    actor: {
      userId: 'local-user-1',
      clerkUserId: 'user-1',
      sessionId: 'session-1',
    },
    user,
  });
  assert.deepEqual(verifiedTokens, ['token']);
  assert.deepEqual(lookedUpIds, ['user-1']);
});

test('a missing user requires explicit provisioning', async () => {
  const service = createAuthenticatedUserService({
    verifySessionToken: async () => identity,
    getUserRepository: async () => createRepository(null),
  });

  await assert.rejects(service.requireUser('token'), (error: unknown) => {
    assert.ok(error instanceof UserProvisioningRequiredError);
    return true;
  });
});

test('a provisioned user produces an authenticated result', async () => {
  const repository = createRepository(null);
  let receivedIdentity: SessionIdentity | undefined;
  let receivedRepository: UserRepositoryPort<TestUser> | undefined;
  const service = createAuthenticatedUserService({
    verifySessionToken: async () => identity,
    getUserRepository: async () => repository,
    provisionUser: async (sessionIdentity, userRepository) => {
      receivedIdentity = sessionIdentity;
      receivedRepository = userRepository;
      return user;
    },
  });

  assert.deepEqual(await service.requireUser('token'), {
    actor: {
      userId: 'local-user-1',
      clerkUserId: 'user-1',
      sessionId: 'session-1',
    },
    user,
  });
  assert.deepEqual(receivedIdentity, identity);
  assert.equal(receivedRepository, repository);
});

test('a provisioned user cannot cross the verified identity boundary', async () => {
  const service = createAuthenticatedUserService({
    verifySessionToken: async () => identity,
    getUserRepository: async () => createRepository(null),
    provisionUser: async () => ({ ...user, clerkUserId: 'user-2' }),
  });

  await assert.rejects(service.requireUser('token'), UserIdentityMismatchError);
});

test('a repository result cannot cross the verified identity boundary', async () => {
  const service = createAuthenticatedUserService({
    verifySessionToken: async () => identity,
    getUserRepository: async () => createRepository({ ...user, clerkUserId: 'user-2' }),
  });

  await assert.rejects(service.requireUser('token'), UserIdentityMismatchError);
});

test('repository initialization and query failures propagate unchanged', async () => {
  const initializationError = new Error('repository initialization failed');
  const queryError = new Error('repository query failed');
  const initializationService = createAuthenticatedUserService({
    verifySessionToken: async () => identity,
    getUserRepository: async () => {
      throw initializationError;
    },
  });
  const queryService = createAuthenticatedUserService({
    verifySessionToken: async () => identity,
    getUserRepository: async () => ({
      async getByClerkId() {
        throw queryError;
      },
    }),
  });

  await assert.rejects(initializationService.requireUser('token'), (error: unknown) => {
    assert.equal(error, initializationError);
    return true;
  });
  await assert.rejects(queryService.requireUser('token'), (error: unknown) => {
    assert.equal(error, queryError);
    return true;
  });
});

test('provisioning failures propagate unchanged', async () => {
  const provisioningError = new Error('provisioning failed');
  const service = createAuthenticatedUserService({
    verifySessionToken: async () => identity,
    getUserRepository: async () => createRepository(null),
    provisionUser: async () => {
      throw provisioningError;
    },
  });

  await assert.rejects(service.requireUser('token'), (error: unknown) => {
    assert.equal(error, provisioningError);
    return true;
  });
});
