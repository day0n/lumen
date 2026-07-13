import assert from 'node:assert/strict';
import test from 'node:test';

import { canUseApiMemoryCache } from '../src/lib/api-client.ts';

test('anonymous memory caching is limited to explicitly public API responses', () => {
  const anonymousHeaders = new Headers();

  for (const pathname of ['/api/home/featured', '/api/home/templates', '/api/tiktok-dashboard']) {
    assert.equal(canUseApiMemoryCache(pathname, anonymousHeaders), true, pathname);
  }

  for (const pathname of [
    '/api/me',
    '/api/projects',
    '/api/folders',
    '/api/material-assets',
    '/api/hot-videos',
  ]) {
    assert.equal(canUseApiMemoryCache(pathname, anonymousHeaders), false, pathname);
  }
});

test('private API responses require a concrete bearer credential for memory caching', () => {
  assert.equal(
    canUseApiMemoryCache('/api/projects', new Headers({ authorization: 'Bearer user-token' })),
    true,
  );

  for (const authorization of ['', 'Bearer', 'Bearer   ', 'Basic shared-cookie-session']) {
    assert.equal(
      canUseApiMemoryCache('/api/projects', new Headers({ authorization })),
      false,
      authorization,
    );
  }
});

test('public path matching does not authorize lookalike private paths', () => {
  const headers = new Headers();
  assert.equal(canUseApiMemoryCache('/api/home/featured-private', headers), false);
  assert.equal(canUseApiMemoryCache('/api/home/templates/private', headers), false);
  assert.equal(canUseApiMemoryCache('/api/tiktok-dashboard-private', headers), false);
});
