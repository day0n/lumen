import assert from 'node:assert/strict';
import test from 'node:test';

import { canUseApiMemoryCache, shouldInvalidateCanonicalApiCache } from '../src/lib/api-client.ts';

test('anonymous memory caching is limited to explicitly public API responses', () => {
  const anonymousHeaders = new Headers();

  for (const pathname of ['/api/home/featured', '/api/home/templates', '/api/tiktok-dashboard']) {
    assert.equal(canUseApiMemoryCache({ pathname, headers: anonymousHeaders }), true, pathname);
  }

  for (const pathname of [
    '/api/me',
    '/api/projects',
    '/api/folders',
    '/api/material-assets',
    '/api/hot-videos',
  ]) {
    assert.equal(canUseApiMemoryCache({ pathname, headers: anonymousHeaders }), false, pathname);
  }
});

test('private API responses require a concrete bearer credential for memory caching', () => {
  assert.equal(
    canUseApiMemoryCache({
      pathname: '/api/projects',
      headers: new Headers({ authorization: 'Bearer user-token' }),
    }),
    true,
  );

  for (const authorization of ['', 'Bearer', 'Bearer   ', 'Basic shared-cookie-session']) {
    assert.equal(
      canUseApiMemoryCache({ pathname: '/api/projects', headers: new Headers({ authorization }) }),
      false,
      authorization,
    );
  }
});

test('public path matching does not authorize lookalike private paths', () => {
  const headers = new Headers();
  assert.equal(canUseApiMemoryCache({ pathname: '/api/home/featured-private', headers }), false);
  assert.equal(canUseApiMemoryCache({ pathname: '/api/home/templates/private', headers }), false);
  assert.equal(canUseApiMemoryCache({ pathname: '/api/tiktok-dashboard-private', headers }), false);
});

test('explicit refresh requests bypass both public and private memory caching', () => {
  const privateHeaders = new Headers({ authorization: 'Bearer user-token' });

  for (const cache of ['no-store', 'no-cache', 'reload'] as const) {
    assert.equal(
      canUseApiMemoryCache({ cache, headers: privateHeaders, pathname: '/api/projects' }),
      false,
      cache,
    );
    assert.equal(
      canUseApiMemoryCache({ cache, headers: new Headers(), pathname: '/api/home/featured' }),
      false,
      cache,
    );
  }

  assert.equal(
    canUseApiMemoryCache({
      cache: 'force-cache',
      headers: privateHeaders,
      pathname: '/api/projects',
    }),
    true,
  );
});

test('fresh=1 bypasses memory caching while other fresh values keep normal policy', () => {
  const headers = new Headers({ authorization: 'Bearer user-token' });

  assert.equal(
    canUseApiMemoryCache({
      headers,
      pathname: '/api/projects',
      searchParams: new URLSearchParams('fresh=1'),
    }),
    false,
  );
  for (const search of ['', 'fresh=0', 'fresh=true', 'other=1']) {
    assert.equal(
      canUseApiMemoryCache({
        headers,
        pathname: '/api/projects',
        searchParams: new URLSearchParams(search),
      }),
      true,
      search,
    );
  }
});

test('project child resources stay outside the app memory cache', () => {
  const headers = new Headers({ authorization: 'Bearer user-token' });

  assert.equal(canUseApiMemoryCache({ headers, pathname: '/api/projects' }), true);
  for (const pathname of [
    '/api/projects/project-1',
    '/api/projects/project-1/workflow-status',
    '/api/projects/project-1/history',
    '/api/projects/project-1/history/history-1',
  ]) {
    assert.equal(canUseApiMemoryCache({ headers, pathname }), false, pathname);
  }
  assert.equal(canUseApiMemoryCache({ headers, pathname: '/api/projects-private' }), false);
});

test('fresh reads invalidate canonical data only after success or an authoritative miss', () => {
  const fresh = new URLSearchParams('fresh=1');
  const ordinary = new URLSearchParams();

  assert.equal(shouldInvalidateCanonicalApiCache('GET', fresh, 200), true);
  assert.equal(shouldInvalidateCanonicalApiCache('HEAD', fresh, 200), false);
  assert.equal(shouldInvalidateCanonicalApiCache('GET', fresh, 204), true);
  assert.equal(shouldInvalidateCanonicalApiCache('GET', fresh, 404), true);
  assert.equal(shouldInvalidateCanonicalApiCache('GET', fresh, 401), false);
  assert.equal(shouldInvalidateCanonicalApiCache('GET', fresh, 500), false);
  assert.equal(shouldInvalidateCanonicalApiCache('GET', ordinary, 200), false);
});
