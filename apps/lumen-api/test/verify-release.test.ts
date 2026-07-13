import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { serve } from '@hono/node-server';

import {
  ReleaseVerificationError,
  parseOptions,
  validateHealthProbe,
  verifyRelease,
} from '../scripts/verify-release.mjs';
import { createApiApp } from '../src/app.ts';

const RELEASE = '0123456789abcdef0123456789abcdef01234567';

test('release verifier accepts a live API release', async (context) => {
  const app = createApiApp({
    homeQueries: {
      async listFeatured() {
        return [];
      },
      async listTemplates() {
        return { categories: [], items: [] };
      },
    },
    readiness: () => ({ mongo: true }),
    readinessTimeoutMs: 50,
    release: RELEASE,
    requiredReadinessChecks: ['mongo'],
  });
  const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port: 0 });
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  if (!server.listening) await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address === 'object');

  const result = await verifyRelease({
    baseUrl: `http://127.0.0.1:${address.port}`,
    intervalMs: 10,
    release: RELEASE,
    timeoutMs: 1_000,
  });

  assert.equal(result.release, RELEASE);
});

test('release verifier polls readiness and validates public routes', async () => {
  let readinessAttempts = 0;
  const requestedPaths: string[] = [];

  const result = await verifyRelease(
    {
      baseUrl: 'http://127.0.0.1:3003',
      intervalMs: 1,
      release: RELEASE,
      timeoutMs: 1_000,
    },
    {
      fetch: async (input: URL | RequestInfo) => {
        const pathname = new URL(String(input)).pathname;
        requestedPaths.push(pathname);

        if (pathname === '/healthz') {
          return jsonResponse(
            { ok: true, release: RELEASE, service: 'lumen-api', ts: Date.now() },
            { noStore: true },
          );
        }
        if (pathname === '/readyz') {
          readinessAttempts += 1;
          if (readinessAttempts === 1) {
            return jsonResponse(
              {
                checks: { mongo: false },
                ok: false,
                release: RELEASE,
                service: 'lumen-api',
                ts: Date.now(),
              },
              { noStore: true, status: 503 },
            );
          }
          return jsonResponse(
            {
              checks: { mongo: true, redis: false },
              ok: true,
              release: RELEASE,
              service: 'lumen-api',
              ts: Date.now(),
            },
            { noStore: true },
          );
        }
        if (pathname === '/api/home/featured') {
          return jsonResponse({ data: { items: [] }, ok: true });
        }
        if (pathname === '/api/home/templates') {
          return jsonResponse({ data: { categories: [], items: [] }, ok: true });
        }
        return jsonResponse({ ok: false }, { status: 404 });
      },
      sleep: async () => {},
    },
  );

  assert.deepEqual(result, {
    baseUrl: 'http://127.0.0.1:3003',
    release: RELEASE,
  });
  assert.equal(readinessAttempts, 2);
  assert.deepEqual(requestedPaths, [
    '/healthz',
    '/readyz',
    '/readyz',
    '/api/home/featured',
    '/api/home/templates',
  ]);
});

test('release verifier rejects incomplete release identifiers', () => {
  assert.throws(
    () => parseOptions(['--release', 'abc123'], {}),
    (error: unknown) =>
      error instanceof ReleaseVerificationError &&
      error.message.includes('full 40-character hexadecimal Git SHA'),
  );
});

test('release verifier rejects a mismatched running release', () => {
  const payload = {
    ok: true,
    release: 'fedcba9876543210fedcba9876543210fedcba98',
    service: 'lumen-api',
    ts: Date.now(),
  };
  assert.throws(
    () =>
      validateHealthProbe(
        {
          body: JSON.stringify(payload),
          payload,
          response: jsonResponse(payload, { noStore: true }),
        },
        RELEASE,
        false,
      ),
    (error: unknown) =>
      error instanceof ReleaseVerificationError && error.message.includes('/healthz body.release'),
  );
});

function jsonResponse(payload: unknown, options: { noStore?: boolean; status?: number } = {}) {
  const headers = new Headers({
    'content-type': 'application/json',
    'x-lumen-release': RELEASE,
    'x-request-id': 'verify-request-1',
  });
  if (options.noStore) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(payload), {
    headers,
    status: options.status ?? 200,
  });
}
