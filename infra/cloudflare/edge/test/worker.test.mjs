import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { preferredLocale, resolveEdgeAction } from '../src/worker.mjs';

const RELEASE = '0123456789abcdef0123456789abcdef01234567';

test('maps static shells without catching backend paths', () => {
  assert.deepEqual(resolveEdgeAction('/', RELEASE), {
    type: 'object',
    kind: 'html',
    objectKey: `releases/${RELEASE}/index.html`,
    release: RELEASE,
    status: 200,
  });
  assert.equal(
    resolveEdgeAction('/app/projects', RELEASE).objectKey,
    `releases/${RELEASE}/app/index.html`,
  );
  assert.deepEqual(resolveEdgeAction('/app/home-posters/selected/agent-pop.webp', RELEASE), {
    type: 'object',
    kind: 'public',
    objectKey: `releases/${RELEASE}/home-posters/selected/agent-pop.webp`,
    release: RELEASE,
    status: 200,
  });
  assert.equal(resolveEdgeAction('/app/assets/missing.js', RELEASE).type, 'not-found');
  assert.equal(resolveEdgeAction('/api/projects', RELEASE).type, 'not-found');
  assert.equal(resolveEdgeAction('/ws/flow', RELEASE).type, 'not-found');
});

test('serves app public media from the active release', async () => {
  const requestedKeys = [];
  const bucket = {
    async get(key) {
      requestedKeys.push(key);
      return {
        body: 'webp-bytes',
        httpEtag: '"poster-etag"',
        size: 10,
        writeHttpMetadata() {},
      };
    },
  };
  const response = await worker.fetch(
    new Request('https://lumenstudio.tech/app/home-posters/selected/agent-pop.webp'),
    {
      ACTIVE_FRONTEND_RELEASE: RELEASE,
      FRONTEND_BUCKET: bucket,
    },
    { waitUntil() {} },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/webp');
  assert.equal(
    response.headers.get('cache-control'),
    'public, max-age=300, stale-while-revalidate=600',
  );
  assert.deepEqual(requestedKeys, [`releases/${RELEASE}/home-posters/selected/agent-pop.webp`]);
});

test('keeps immutable assets pinned to their requested release', () => {
  const oldRelease = 'abcdef0123456789abcdef0123456789abcdef01';
  assert.deepEqual(resolveEdgeAction(`/_static/releases/${oldRelease}/assets/app.js`, RELEASE), {
    type: 'object',
    kind: 'immutable',
    objectKey: `releases/${oldRelease}/assets/app.js`,
    release: oldRelease,
    status: 200,
  });
  assert.equal(
    resolveEdgeAction(`/_static/releases/${oldRelease}/%2e%2e/private`, RELEASE).type,
    'not-found',
  );
  assert.equal(
    resolveEdgeAction(`/_static/releases/${oldRelease}/assets/app.js.map`, RELEASE).type,
    'not-found',
  );
});

test('normalizes legacy and locale-prefixed routes', () => {
  assert.deepEqual(resolveEdgeAction('/home', RELEASE), {
    type: 'redirect',
    pathname: '/app/home',
  });
  assert.deepEqual(resolveEdgeAction('/zh/app/projects', RELEASE), {
    type: 'redirect',
    pathname: '/app/projects',
    locale: 'zh',
  });
  assert.deepEqual(resolveEdgeAction('/app/en/app/canvas/new', RELEASE), {
    type: 'redirect',
    pathname: '/app/canvas/new',
  });
  assert.deepEqual(resolveEdgeAction('/canvas', RELEASE), {
    type: 'redirect',
    pathname: '/app/projects',
  });
  assert.deepEqual(resolveEdgeAction('/canvas/projects', RELEASE), {
    type: 'redirect',
    pathname: '/app/projects',
  });
  assert.deepEqual(resolveEdgeAction('/zh/home', RELEASE), {
    type: 'redirect',
    pathname: '/app/home',
    locale: 'zh',
  });
  assert.deepEqual(resolveEdgeAction('/zh/canvas/projects', RELEASE), {
    type: 'redirect',
    pathname: '/app/projects',
    locale: 'zh',
  });
  assert.deepEqual(resolveEdgeAction('/zh/agent-chat', RELEASE), {
    type: 'redirect',
    pathname: '/app/canvas/new',
    search: '?agent=chat',
    locale: 'zh',
  });
  assert.deepEqual(resolveEdgeAction('/en/materials', RELEASE), {
    type: 'redirect',
    pathname: '/app/materials',
    locale: 'en',
  });
});

test('serves all app-owned public asset families from the active release', () => {
  for (const pathname of [
    '/home-posters/selected/agent-pop.webp',
    '/home-templates/featured/cover.webp',
    '/material-showcase/character-01.webp',
    '/particle-masks/sparkle.png',
  ]) {
    assert.deepEqual(resolveEdgeAction(pathname, RELEASE), {
      type: 'object',
      kind: 'public',
      objectKey: `releases/${RELEASE}/${pathname.slice(1)}`,
      release: RELEASE,
      status: 200,
    });
  }
  assert.equal(
    resolveEdgeAction('/material-showcase/%2e%2e/private.webp', RELEASE).type,
    'not-found',
  );
});

test('uses the explicit locale cookie before browser preference', () => {
  assert.equal(
    preferredLocale(
      new Request('https://lumenstudio.tech/', {
        headers: {
          cookie: 'lumen_locale=en',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      }),
    ),
    'en',
  );
  assert.equal(
    preferredLocale(
      new Request('https://lumenstudio.tech/', {
        headers: { 'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8' },
      }),
    ),
    'zh',
  );
});

test('serves an app shell with release and cache headers', async () => {
  const requestedKeys = [];
  const bucket = {
    async get(key) {
      requestedKeys.push(key);
      if (key !== `releases/${RELEASE}/app/index.html`) return null;
      const body = '<!doctype html><title>App</title>';
      return {
        body,
        httpEtag: '"shell-etag"',
        size: body.length,
        writeHttpMetadata(headers) {
          headers.set('content-type', 'text/html; charset=utf-8');
        },
      };
    },
  };
  const response = await worker.fetch(
    new Request('https://lumenstudio.tech/app/projects'),
    {
      ACTIVE_FRONTEND_RELEASE: RELEASE,
      FRONTEND_BUCKET: bucket,
    },
    { waitUntil() {} },
  );

  assert.equal(response.status, 200);
  assert.equal(await response.text(), '<!doctype html><title>App</title>');
  assert.deepEqual(requestedKeys, [`releases/${RELEASE}/app/index.html`]);
  assert.equal(response.headers.get('x-lumen-release'), RELEASE);
  assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
});

test('supports HEAD and conditional requests without returning a body', async () => {
  const object = {
    httpEtag: '"asset-etag"',
    size: 12,
    writeHttpMetadata(headers) {
      headers.set('content-type', 'text/javascript');
    },
  };
  const bucket = {
    async head() {
      return object;
    },
    async get() {
      return { ...object, body: 'console.log()' };
    },
  };
  const env = {
    ACTIVE_FRONTEND_RELEASE: RELEASE,
    FRONTEND_BUCKET: bucket,
  };
  const context = { waitUntil() {} };
  const url = `https://lumenstudio.tech/_static/releases/${RELEASE}/assets/app.js`;

  const headResponse = await worker.fetch(new Request(url, { method: 'HEAD' }), env, context);
  assert.equal(headResponse.status, 200);
  assert.equal(await headResponse.text(), '');
  assert.equal(headResponse.headers.get('etag'), '"asset-etag"');

  const notModified = await worker.fetch(
    new Request(url, { headers: { 'if-none-match': '"asset-etag"' } }),
    env,
    context,
  );
  assert.equal(notModified.status, 304);
  assert.equal(await notModified.text(), '');
});

test('uses a precompressed object only when the browser accepts it', async () => {
  const requestedKeys = [];
  const bucket = {
    async get(key) {
      requestedKeys.push(key);
      return {
        body: 'compressed',
        httpEtag: '"compressed-etag"',
        size: 10,
        writeHttpMetadata() {},
      };
    },
  };
  const response = await worker.fetch(
    new Request(`https://lumenstudio.tech/_static/releases/${RELEASE}/assets/app.js`, {
      headers: { 'accept-encoding': 'br, gzip' },
    }),
    {
      ACTIVE_FRONTEND_RELEASE: RELEASE,
      FRONTEND_BUCKET: bucket,
    },
    { waitUntil() {} },
  );

  assert.deepEqual(requestedKeys, [`releases/${RELEASE}/assets/app.js.br`]);
  assert.equal(response.headers.get('content-encoding'), 'br');
  assert.equal(response.headers.get('vary'), 'Accept-Encoding');
});

test('fails closed when the active release or method is invalid', async () => {
  const bucket = {
    async get() {
      return null;
    },
  };
  const invalidRelease = await worker.fetch(
    new Request('https://lumenstudio.tech/app/home'),
    { ACTIVE_FRONTEND_RELEASE: 'latest', FRONTEND_BUCKET: bucket },
    { waitUntil() {} },
  );
  assert.equal(invalidRelease.status, 503);

  const invalidMethod = await worker.fetch(
    new Request('https://lumenstudio.tech/app/home', { method: 'POST' }),
    { ACTIVE_FRONTEND_RELEASE: RELEASE, FRONTEND_BUCKET: bucket },
    { waitUntil() {} },
  );
  assert.equal(invalidMethod.status, 405);
  assert.equal(invalidMethod.headers.get('allow'), 'GET, HEAD');
});

test('returns a retryable failure when the active shell or bucket is unavailable', async () => {
  const missingShell = await worker.fetch(
    new Request('https://lumenstudio.tech/app/home'),
    {
      ACTIVE_FRONTEND_RELEASE: RELEASE,
      FRONTEND_BUCKET: {
        async get() {
          return null;
        },
      },
    },
    { waitUntil() {} },
  );
  assert.equal(missingShell.status, 503);
  assert.equal(missingShell.headers.get('retry-after'), '5');

  const failedBucket = await worker.fetch(
    new Request('https://lumenstudio.tech/app/home'),
    {
      ACTIVE_FRONTEND_RELEASE: RELEASE,
      FRONTEND_BUCKET: {
        async get() {
          throw new Error('unavailable');
        },
      },
    },
    { waitUntil() {} },
  );
  assert.equal(failedBucket.status, 503);
  assert.equal(failedBucket.headers.get('cache-control'), 'no-store');
});
