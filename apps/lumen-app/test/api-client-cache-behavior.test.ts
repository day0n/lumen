import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiMemoryResponseCache } from '../src/lib/api-client.ts';

const jsonHeaders = {
  'cache-control': 'private, no-store',
  'content-type': 'application/json; charset=utf-8',
};

function apiUrl(path: string) {
  return new URL(path, 'https://lumen.test');
}

function privateHeaders(token: string, locale = 'en') {
  return new Headers({
    authorization: `Bearer ${token}`,
    'x-lumen-locale': locale,
  });
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: jsonHeaders });
}

function deferredJsonResponse() {
  let release = () => {};
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      release = () => {
        controller.enqueue(new TextEncoder().encode('{"ok":true}'));
        controller.close();
      };
    },
  });

  return {
    release,
    response: new Response(body, { status: 200, headers: jsonHeaders }),
  };
}

test('the tab-local cache isolates locale and query while retaining explicit private responses', async () => {
  let now = 1_000;
  const cache = createApiMemoryResponseCache(() => now);
  const headers = privateHeaders('token-a');
  const url = apiUrl('/api/projects?limit=3');
  const scope = cache.captureScope(headers);

  assert.equal(scope.kind, 'private');
  assert.doesNotMatch(scope.key, /token-a/);
  await cache.write(url, headers, jsonResponse({ version: 1 }), scope, cache.captureVersion());

  assert.equal(cache.size(), 1);
  assert.deepEqual(await cache.read(url, headers, scope)?.json(), { version: 1 });
  assert.equal(cache.read(url, privateHeaders('token-a', 'zh'), scope), null);
  assert.equal(cache.read(apiUrl('/api/projects?limit=4'), headers, scope), null);

  const sameTokenScope = cache.captureScope(headers);
  assert.equal(sameTokenScope.key, scope.key);
  assert.deepEqual(await cache.read(url, headers, sameTokenScope)?.json(), { version: 1 });

  now += 60_001;
  assert.equal(cache.read(url, headers, sameTokenScope), null);
  assert.equal(cache.size(), 0);
});

test('credential rotation and sign-out discard private entries without retaining tokens in keys', async () => {
  const cache = createApiMemoryResponseCache();
  const url = apiUrl('/api/projects');
  const headersA = privateHeaders('token-a');
  const scopeA = cache.captureScope(headersA);

  await cache.write(url, headersA, jsonResponse({ owner: 'a' }), scopeA, cache.captureVersion());
  assert.equal(cache.size(), 1);

  const headersB = privateHeaders('token-b');
  const scopeB = cache.captureScope(headersB);
  assert.notEqual(scopeB.key, scopeA.key);
  assert.doesNotMatch(scopeB.key, /token-[ab]/);
  assert.equal(cache.size(), 0);
  assert.equal(cache.read(url, headersB, scopeB), null);
  assert.equal(cache.read(url, headersA, scopeA), null);

  await cache.write(url, headersB, jsonResponse({ owner: 'b' }), scopeB, cache.captureVersion());
  assert.equal(cache.size(), 1);
  cache.clearPrivate();
  assert.equal(cache.size(), 0);
  assert.equal(cache.read(url, headersB, scopeB), null);
});

test('a slow response cannot refill private data after the credential changes', async () => {
  const cache = createApiMemoryResponseCache();
  const url = apiUrl('/api/projects');
  const headersA = privateHeaders('token-a');
  const scopeA = cache.captureScope(headersA);
  const deferred = deferredJsonResponse();

  const write = cache.write(url, headersA, deferred.response, scopeA, cache.captureVersion());
  cache.captureScope(privateHeaders('token-b'));
  deferred.release();
  await write;

  assert.equal(cache.size(), 0);
});

test('mutation and canonical invalidation block stale in-flight cache writes', async () => {
  const cache = createApiMemoryResponseCache();
  const url = apiUrl('/api/projects');
  const headers = privateHeaders('token-a');
  const scope = cache.captureScope(headers);

  const mutationRace = deferredJsonResponse();
  const staleMutationWrite = cache.write(
    url,
    headers,
    mutationRace.response,
    scope,
    cache.captureVersion(),
  );
  cache.clearForMutation('/api/projects/project-1');
  mutationRace.release();
  await staleMutationWrite;
  assert.equal(cache.size(), 0);

  const freshRace = deferredJsonResponse();
  const staleFreshWrite = cache.write(
    url,
    headers,
    freshRace.response,
    scope,
    cache.captureVersion(),
  );
  cache.clearCanonical(apiUrl('/api/projects?fresh=1'), scope);
  freshRace.release();
  await staleFreshWrite;
  assert.equal(cache.size(), 0);

  const unrelatedRace = deferredJsonResponse();
  const allowedWrite = cache.write(
    url,
    headers,
    unrelatedRace.response,
    scope,
    cache.captureVersion(),
  );
  cache.clearForMutation('/api/unrelated');
  unrelatedRace.release();
  await allowedWrite;
  assert.equal(cache.size(), 1);
});

test('only successful JSON responses enter the explicit app cache', async () => {
  const cache = createApiMemoryResponseCache();
  const url = apiUrl('/api/projects');
  const headers = privateHeaders('token-a');
  const scope = cache.captureScope(headers);

  await cache.write(url, headers, jsonResponse({ ok: false }, 500), scope, cache.captureVersion());
  await cache.write(
    url,
    headers,
    new Response('plain text', { headers: { 'content-type': 'text/plain' } }),
    scope,
    cache.captureVersion(),
  );
  assert.equal(cache.size(), 0);

  await cache.write(url, headers, jsonResponse({ ok: true }), scope, cache.captureVersion());
  assert.equal(cache.size(), 1);
  assert.equal(cache.read(url, headers, scope)?.headers.get('cache-control'), 'private, no-store');
});
