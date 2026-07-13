import assert from 'node:assert/strict';
import test from 'node:test';
import { TokenVerificationError, TokenVerificationErrorReason } from '@clerk/backend/errors';

import { createIdentityProvider } from '../src/auth/identity-provider.ts';
import { readSessionToken } from '../src/http/session-token.ts';

const VALID_JWT = `${Buffer.from(JSON.stringify({ alg: 'RS256' })).toString('base64url')}.${Buffer.from(
  JSON.stringify({ sub: 'user-1' }),
).toString('base64url')}.${Buffer.from('signature').toString('base64url')}`;

test('session token prefers bearer authorization and accepts session cookies', () => {
  assert.equal(
    readSessionToken(
      new Request('https://lumen.local/api/me', {
        headers: {
          authorization: 'Bearer bearer-token',
          cookie: '__session=cookie-token',
        },
      }),
    ),
    'bearer-token',
  );
  assert.equal(
    readSessionToken(
      new Request('https://lumen.local/api/me', {
        headers: { cookie: 'other=value; __session_example=cookie%3Dtoken' },
      }),
    ),
    'cookie=token',
  );
});

test('session token rejects unrelated and empty credentials', () => {
  assert.equal(
    readSessionToken(
      new Request('https://lumen.local/api/me', {
        headers: { authorization: 'Basic credentials', cookie: '__session=' },
      }),
    ),
    null,
  );
  assert.equal(
    readSessionToken(
      new Request('https://lumen.local/api/me', {
        headers: { authorization: 'Basic explicit-credential', cookie: '__session=cookie-token' },
      }),
    ),
    null,
  );
  assert.equal(
    readSessionToken(
      new Request('https://lumen.local/api/me', {
        headers: { authorization: 'Bearer   ', cookie: '__session=cookie-token' },
      }),
    ),
    null,
  );
});

test('identity provider returns only the verified user and session identifiers', async () => {
  const calls: unknown[] = [];
  const provider = createIdentityProvider(
    {
      authorizedParties: ['https://lumen.local'],
      jwtKey: 'public-key',
      secretKey: 'secret-key',
    },
    {
      verify: (async (token: string, options: unknown) => {
        calls.push({ options, token });
        return { azp: 'https://lumen.local', sid: 'session-1', sub: 'user-1' };
      }) as never,
    },
  );

  assert.deepEqual(await provider.verifySessionToken(VALID_JWT), {
    clerkUserId: 'user-1',
    sessionId: 'session-1',
  });
  assert.deepEqual(calls, [
    {
      options: {
        authorizedParties: ['https://lumen.local'],
        clockSkewInMs: 5_000,
        jwtKey: 'public-key',
        secretKey: 'secret-key',
      },
      token: VALID_JWT,
    },
  ]);
});

test('identity provider rejects missing configuration and non-session payloads', async () => {
  const unconfigured = createIdentityProvider(
    { authorizedParties: [], secretKey: '' },
    { verify: (async () => ({ sub: 'unused' })) as never },
  );
  await assert.rejects(unconfigured.verifySessionToken(VALID_JWT), /not configured/);

  const invalidPayloads = [
    { azp: 'https://lumen.local', sid: 'session-1' },
    { azp: 'https://lumen.local', sub: 'user-1' },
    { sid: 'session-1', sub: 'user-1' },
    { azp: 'https://other.local', sid: 'session-1', sub: 'user-1' },
  ];
  for (const payload of invalidPayloads) {
    const invalidProvider = createIdentityProvider(
      { authorizedParties: ['https://lumen.local'], secretKey: 'secret-key' },
      { verify: (async () => payload) as never },
    );
    assert.equal(await invalidProvider.verifySessionToken(VALID_JWT), null);
  }
});

test('identity provider distinguishes invalid sessions from verification outages', async () => {
  const invalidSession = createIdentityProvider(
    { authorizedParties: [], secretKey: 'secret-key' },
    {
      verify: (async () => {
        throw new TokenVerificationError({
          message: 'expired',
          reason: TokenVerificationErrorReason.TokenExpired,
        });
      }) as never,
    },
  );
  assert.equal(await invalidSession.verifySessionToken(VALID_JWT), null);

  const outage = new TokenVerificationError({
    message: 'unavailable',
    reason: TokenVerificationErrorReason.RemoteJWKFailedToLoad,
  });
  const unavailableProvider = createIdentityProvider(
    { authorizedParties: [], secretKey: 'secret-key' },
    {
      verify: (async () => {
        throw outage;
      }) as never,
    },
  );
  await assert.rejects(unavailableProvider.verifySessionToken(VALID_JWT), (error: unknown) => {
    assert.equal(error, outage);
    return true;
  });
});

test('identity provider rejects locally malformed tokens without an upstream failure', async () => {
  const provider = createIdentityProvider({
    authorizedParties: ['https://lumen.local'],
    secretKey: 'secret-key',
  });

  assert.equal(await provider.verifySessionToken('a.b.c'), null);
  assert.equal(await provider.verifySessionToken('not-a-jwt'), null);
});
