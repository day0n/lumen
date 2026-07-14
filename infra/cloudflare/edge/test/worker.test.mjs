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
  assert.deepEqual(resolveEdgeAction('/zh', RELEASE), {
    type: 'object',
    kind: 'html',
    objectKey: `releases/${RELEASE}/zh/index.html`,
    release: RELEASE,
    status: 200,
  });
  assert.equal(
    resolveEdgeAction('/app/projects', RELEASE).objectKey,
    `releases/${RELEASE}/app/index.html`,
  );
  for (const pathname of [
    '/share',
    '/share/0123456789abcdef0123456789abcdef',
    '/zh/share',
    '/zh/share/0123456789abcdef0123456789abcdef',
  ]) {
    assert.deepEqual(resolveEdgeAction(pathname, RELEASE), {
      type: 'object',
      kind: 'html',
      objectKey: `releases/${RELEASE}/share/index.html`,
      release: RELEASE,
      status: 200,
    });
  }
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

test('sets the media type for JPEG public assets without bucket metadata', async () => {
  const response = await worker.fetch(
    new Request('https://lumenstudio.tech/particle-masks/creator-typing-mask.jpg'),
    {
      ACTIVE_FRONTEND_RELEASE: RELEASE,
      FRONTEND_BUCKET: {
        async get() {
          return {
            body: 'jpeg-bytes',
            httpEtag: '"jpeg-etag"',
            size: 10,
            writeHttpMetadata() {},
          };
        },
      },
    },
    { waitUntil() {} },
  );

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('content-type'), 'image/jpeg');
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
  assert.equal(
    resolveEdgeAction(`/_static/releases/${oldRelease}/app/index.html`, RELEASE).type,
    'not-found',
  );
  assert.equal(
    resolveEdgeAction(`/_static/releases/${oldRelease}/share/index.html`, RELEASE).type,
    'not-found',
  );
  assert.equal(
    resolveEdgeAction(`/_static/releases/${oldRelease}/index.html`, RELEASE).type,
    'not-found',
  );
  assert.equal(
    resolveEdgeAction(`/_static/releases/${oldRelease}/zh/index.html`, RELEASE).type,
    'not-found',
  );
  assert.equal(
    resolveEdgeAction(`/_static/releases/${oldRelease}/private.txt`, RELEASE).type,
    'not-found',
  );
  assert.deepEqual(
    resolveEdgeAction(
      `/_static/releases/${oldRelease}/home-posters/selected/agent-pop.webp`,
      RELEASE,
    ),
    {
      type: 'object',
      kind: 'immutable',
      objectKey: `releases/${oldRelease}/home-posters/selected/agent-pop.webp`,
      release: oldRelease,
      status: 200,
    },
  );
});

test('normalizes legacy and locale-prefixed routes', () => {
  assert.deepEqual(resolveEdgeAction('/zh/', RELEASE), {
    type: 'redirect',
    pathname: '/zh',
    locale: 'zh',
  });
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

test('does not overmatch reserved server-rendered route names', () => {
  assert.equal(
    resolveEdgeAction('/zh/sign-injected', RELEASE).objectKey,
    `releases/${RELEASE}/404.html`,
  );
  assert.equal(resolveEdgeAction('/shareholder/report', RELEASE).type, 'not-found');
});

test('preserves redirect query parameters while adding the route action', async () => {
  const response = await worker.fetch(
    new Request('https://lumenstudio.tech/agent-chat?source=bookmark&agent=other'),
    {
      ACTIVE_FRONTEND_RELEASE: RELEASE,
      FRONTEND_BUCKET: {},
    },
    { waitUntil() {} },
  );

  assert.equal(response.status, 308);
  assert.equal(
    response.headers.get('location'),
    'https://lumenstudio.tech/app/canvas/new?source=bookmark&agent=chat',
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

test('serves English and Chinese landing shells from distinct release objects', async () => {
  const requestedKeys = [];
  const bodies = new Map([
    [`releases/${RELEASE}/index.html`, '<html lang="en"><title>English landing</title></html>'],
    [`releases/${RELEASE}/zh/index.html`, '<html lang="zh-CN"><title>中文首页</title></html>'],
  ]);
  const bucket = {
    async get(key) {
      requestedKeys.push(key);
      const body = bodies.get(key);
      if (!body) return null;
      return {
        body,
        httpEtag: `"${key}"`,
        size: body.length,
        writeHttpMetadata(headers) {
          headers.set('content-type', 'text/html; charset=utf-8');
        },
      };
    },
  };
  const environment = {
    ACTIVE_FRONTEND_RELEASE: RELEASE,
    FRONTEND_BUCKET: bucket,
  };
  const context = { waitUntil() {} };

  const english = await worker.fetch(
    new Request('https://lumenstudio.tech/', {
      headers: { cookie: 'lumen_locale=en' },
    }),
    environment,
    context,
  );
  const chinese = await worker.fetch(
    new Request('https://lumenstudio.tech/zh'),
    environment,
    context,
  );

  assert.equal(english.status, 200);
  assert.match(await english.text(), /lang="en"/);
  assert.equal(chinese.status, 200);
  assert.match(await chinese.text(), /lang="zh-CN"/);
  assert.deepEqual(requestedKeys, [
    `releases/${RELEASE}/index.html`,
    `releases/${RELEASE}/zh/index.html`,
  ]);
  for (const response of [english, chinese]) {
    assert.equal(response.headers.get('x-lumen-release'), RELEASE);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=0, must-revalidate');
  }
});

test('redirects the trailing-slash Chinese landing path to its canonical URL', async () => {
  const response = await worker.fetch(
    new Request('https://lumenstudio.tech/zh/?source=bookmark'),
    {
      ACTIVE_FRONTEND_RELEASE: RELEASE,
      FRONTEND_BUCKET: {},
    },
    { waitUntil() {} },
  );

  assert.equal(response.status, 308);
  assert.equal(response.headers.get('location'), 'https://lumenstudio.tech/zh?source=bookmark');
  assert.match(response.headers.get('set-cookie') ?? '', /lumen_locale=zh/);
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

test('honors encoding quality values and ignores disabled encodings', async () => {
  const requestedKeys = [];
  const bucket = {
    async get(key) {
      requestedKeys.push(key);
      return {
        body: 'bytes',
        httpEtag: `"${key}"`,
        size: 5,
        writeHttpMetadata() {},
      };
    },
  };
  const environment = { ACTIVE_FRONTEND_RELEASE: RELEASE, FRONTEND_BUCKET: bucket };
  const executionContext = { waitUntil() {} };
  const url = `https://lumenstudio.tech/_static/releases/${RELEASE}/assets/app.js`;

  const gzipResponse = await worker.fetch(
    new Request(url, { headers: { 'accept-encoding': 'br;q=0, gzip;q=1' } }),
    environment,
    executionContext,
  );
  assert.equal(gzipResponse.headers.get('content-encoding'), 'gzip');
  assert.equal(requestedKeys.at(-1), `releases/${RELEASE}/assets/app.js.gz`);

  const rawResponse = await worker.fetch(
    new Request(url, { headers: { 'accept-encoding': 'br;q=0, gzip;q=0' } }),
    environment,
    executionContext,
  );
  assert.equal(rawResponse.headers.get('content-encoding'), null);
  assert.equal(requestedKeys.at(-1), `releases/${RELEASE}/assets/app.js`);
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
