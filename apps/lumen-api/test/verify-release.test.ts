import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { serve } from '@hono/node-server';
import { Hono } from 'hono';

import {
  ReleaseVerificationError,
  parseOptions,
  validateHealthProbe,
  verifyRelease,
} from '../scripts/verify-release.mjs';
import { createApiApp } from '../src/app.ts';

const RELEASE = '0123456789abcdef0123456789abcdef01234567';

test('release verifier checks live direct and public origins', async (context) => {
  const apiApp = createApiApp({
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
  const apiServer = serve({ fetch: apiApp.fetch, hostname: '127.0.0.1', port: 0 });
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        apiServer.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  if (!apiServer.listening) await once(apiServer, 'listening');
  const apiAddress = apiServer.address();
  assert.ok(apiAddress && typeof apiAddress === 'object');
  const baseUrl = `http://127.0.0.1:${apiAddress.port}`;

  const publicRequests: string[] = [];
  const publicApp = new Hono();
  publicApp.all('*', async (requestContext) => {
    const requestUrl = new URL(requestContext.req.url);
    publicRequests.push(requestUrl.pathname);
    return fetch(new URL(`${requestUrl.pathname}${requestUrl.search}`, `${baseUrl}/`));
  });
  const publicServer = serve({ fetch: publicApp.fetch, hostname: '127.0.0.1', port: 0 });
  context.after(
    () =>
      new Promise<void>((resolve, reject) => {
        publicServer.close((error) => (error ? reject(error) : resolve()));
      }),
  );
  if (!publicServer.listening) await once(publicServer, 'listening');
  const publicAddress = publicServer.address();
  assert.ok(publicAddress && typeof publicAddress === 'object');
  const publicBaseUrl = `http://127.0.0.1:${publicAddress.port}`;

  const result = await verifyRelease({
    baseUrl,
    intervalMs: 10,
    publicBaseUrl,
    release: RELEASE,
    timeoutMs: 1_000,
  });

  assert.deepEqual(result, { baseUrl, publicBaseUrl, release: RELEASE });
  assert.deepEqual(publicRequests, ['/api/home/featured', '/api/home/templates']);
});

test('release verifier polls readiness and validates public routes', async () => {
  let readinessAttempts = 0;
  const requestedUrls: string[] = [];
  const baseUrl = 'http://127.0.0.1:3003';
  const publicBaseUrl = 'https://lumenstudio.test';

  const result = await verifyRelease(
    {
      baseUrl,
      intervalMs: 1,
      publicBaseUrl,
      release: RELEASE,
      timeoutMs: 1_000,
    },
    {
      fetch: async (input: URL | RequestInfo) => {
        const url = new URL(String(input));
        const { pathname } = url;
        requestedUrls.push(url.href);

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
    baseUrl,
    publicBaseUrl,
    release: RELEASE,
  });
  assert.equal(readinessAttempts, 2);
  assert.deepEqual(requestedUrls, [
    `${baseUrl}/healthz`,
    `${baseUrl}/readyz`,
    `${baseUrl}/readyz`,
    `${publicBaseUrl}/api/home/featured`,
    `${publicBaseUrl}/api/home/templates`,
  ]);
});

test('release verifier parses and defaults the public origin', () => {
  const baseUrl = 'http://127.0.0.1:3100';
  assert.deepEqual(parseOptions(['--base-url', baseUrl, '--release', RELEASE], {}), {
    baseUrl,
    intervalMs: 500,
    publicBaseUrl: baseUrl,
    release: RELEASE,
    timeoutMs: 30_000,
  });

  assert.equal(
    parseOptions(['--release', RELEASE], {
      LUMEN_API_VERIFY_BASE_URL: baseUrl,
      LUMEN_API_VERIFY_PUBLIC_BASE_URL: 'https://lumenstudio.test/',
    }).publicBaseUrl,
    'https://lumenstudio.test',
  );
});

test('public home responses retain release, request id and schema validation', async () => {
  const differentRelease = 'fedcba9876543210fedcba9876543210fedcba98';
  const cases = [
    {
      createFeaturedResponse: () =>
        jsonResponse({ data: { items: [] }, ok: true }, { release: differentRelease }),
      expectedMessage: 'x-lumen-release header',
    },
    {
      createFeaturedResponse: () =>
        jsonResponse({ data: { items: [] }, ok: true }, { requestId: null }),
      expectedMessage: 'x-request-id header',
    },
    {
      createFeaturedResponse: () => jsonResponse({ data: { items: 'invalid' }, ok: true }),
      expectedMessage: 'body.data.items must be an array',
    },
  ];

  for (const verificationCase of cases) {
    await assert.rejects(
      verifyRelease(
        {
          baseUrl: 'http://127.0.0.1:3003',
          intervalMs: 1,
          publicBaseUrl: 'https://lumenstudio.test',
          release: RELEASE,
          timeoutMs: 1_000,
        },
        {
          fetch: async (input: URL | RequestInfo) => {
            const pathname = new URL(String(input)).pathname;
            if (pathname === '/healthz') {
              return jsonResponse(
                { ok: true, release: RELEASE, service: 'lumen-api', ts: Date.now() },
                { noStore: true },
              );
            }
            if (pathname === '/readyz') {
              return jsonResponse(
                {
                  checks: { mongo: true },
                  ok: true,
                  release: RELEASE,
                  service: 'lumen-api',
                  ts: Date.now(),
                },
                { noStore: true },
              );
            }
            if (pathname === '/api/home/featured') {
              return verificationCase.createFeaturedResponse();
            }
            return jsonResponse({ data: { categories: [], items: [] }, ok: true });
          },
          sleep: async () => {},
        },
      ),
      (error: unknown) =>
        error instanceof ReleaseVerificationError &&
        error.message.includes(verificationCase.expectedMessage),
    );
  }
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

function jsonResponse(
  payload: unknown,
  options: {
    noStore?: boolean;
    release?: null | string;
    requestId?: null | string;
    status?: number;
  } = {},
) {
  const headers = new Headers({ 'content-type': 'application/json' });
  if (options.release !== null) headers.set('x-lumen-release', options.release ?? RELEASE);
  if (options.requestId !== null) {
    headers.set('x-request-id', options.requestId ?? 'verify-request-1');
  }
  if (options.noStore) headers.set('cache-control', 'no-store');
  return new Response(JSON.stringify(payload), {
    headers,
    status: options.status ?? 200,
  });
}
