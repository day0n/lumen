import assert from 'node:assert/strict';
import test from 'node:test';

import { verifyDeployment, verifyDeploymentWithRetry } from '../scripts/verify-deployment.mjs';

const RELEASE = '0123456789abcdef0123456789abcdef01234567';

test('verifies every static shell and production origin passthrough', async () => {
  const requests = [];
  const result = await verifyDeployment({
    baseUrl: 'https://lumenstudio.tech',
    fetchImpl: async (url, init) => {
      requests.push({ init, pathname: url.pathname });
      return responseFor(url.pathname);
    },
    release: RELEASE,
    requireOriginPassthrough: true,
  });

  assert.deepEqual(result, {
    baseUrl: 'https://lumenstudio.tech',
    release: RELEASE,
    originPassthrough: true,
    verified: true,
  });
  assert.deepEqual(
    requests.map((request) => request.pathname),
    [
      '/app/home',
      '/share/00000000000000000000000000000000',
      '/sign-in',
      '/zh/sign-up',
      '/',
      '/zh',
      '/sign-in',
      '/zh/sign-up',
      '/missing-static-page',
      '/zh/missing-static-page',
      '/api/me',
    ],
  );
  assert.equal(
    requests.every((request) => request.init.redirect === 'manual'),
    true,
  );
});

test('rejects stale releases and malformed recovery pages', async () => {
  await assert.rejects(
    verifyDeployment({
      baseUrl: 'https://lumenstudio.tech',
      fetchImpl: async (url) => {
        const response = responseFor(url.pathname);
        if (url.pathname === '/app/home') {
          response.headers.set('x-lumen-release', 'f'.repeat(40));
        }
        return response;
      },
      release: RELEASE,
    }),
    /\/app\/home returned release/,
  );

  await assert.rejects(
    verifyDeployment({
      baseUrl: 'https://lumenstudio.tech',
      fetchImpl: async (url) => {
        if (url.pathname === '/missing-static-page') {
          return new Response('<html lang="en"><title>Page not found — Lumen</title></html>', {
            status: 404,
            headers: { 'x-lumen-release': RELEASE },
          });
        }
        return responseFor(url.pathname);
      },
      release: RELEASE,
    }),
    /missing-static-page must remain noindex/,
  );
});

test('retries transient deployment propagation failures', async () => {
  let requests = 0;
  const delays = [];
  const retries = [];
  const result = await verifyDeploymentWithRetry({
    attempts: 3,
    baseUrl: 'https://lumenstudio.tech',
    delayMs: 25,
    fetchImpl: async (url) => {
      requests += 1;
      if (requests === 1) return new Response('pending', { status: 503 });
      return responseFor(url.pathname);
    },
    onRetry(value) {
      retries.push(value.attempt);
    },
    release: RELEASE,
    sleep: async (delayMs) => delays.push(delayMs),
  });

  assert.equal(result.attempt, 2);
  assert.deepEqual(retries, [1]);
  assert.deepEqual(delays, [25]);
});

function responseFor(pathname) {
  if (pathname === '/api/me') {
    return Response.json({ ok: false, error: { message: 'Sign in required' } }, { status: 401 });
  }

  const definition = documents.get(pathname);
  if (definition) {
    return new Response(documentHtml(definition), {
      status: definition.status,
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'x-lumen-release': RELEASE,
      },
    });
  }
  return new Response('<html><body>shell</body></html>', {
    status: 200,
    headers: { 'x-lumen-release': RELEASE },
  });
}

const documents = new Map([
  [
    '/',
    {
      body: '<main>landing</main>',
      lang: 'en',
      marker: 'data-lumen-static-landing="en" data-lumen-prerendered="true"',
      status: 200,
      title: 'Lumen — Turn products into videos that sell',
    },
  ],
  [
    '/zh',
    {
      body: '<main>首页</main>',
      lang: 'zh-CN',
      marker: 'data-lumen-static-landing="zh" data-lumen-prerendered="true"',
      status: 200,
      title: 'Lumen — 把商品变成爆款带货视频',
    },
  ],
  [
    '/sign-in',
    {
      body: '<main class="auth-loading">loading</main>',
      lang: 'en',
      marker: 'data-lumen-static-auth="en"',
      noindex: true,
      status: 200,
      title: 'Account — Lumen',
    },
  ],
  [
    '/zh/sign-up',
    {
      body: '<main class="auth-loading">加载中</main>',
      lang: 'zh-CN',
      marker: 'data-lumen-static-auth="zh"',
      noindex: true,
      status: 200,
      title: '账户 — Lumen',
    },
  ],
  [
    '/missing-static-page',
    {
      body: '<main class="not-found-content">404</main>',
      lang: 'en',
      marker: 'data-lumen-static-not-found="en"',
      noindex: true,
      status: 404,
      title: 'Page not found — Lumen',
    },
  ],
  [
    '/zh/missing-static-page',
    {
      body: '<main class="not-found-content">404</main>',
      lang: 'zh-CN',
      marker: 'data-lumen-static-not-found="zh"',
      noindex: true,
      status: 404,
      title: '页面不存在 — Lumen',
    },
  ],
]);

function documentHtml(definition) {
  return [
    `<html lang="${definition.lang}">`,
    '<head>',
    `<title>${definition.title}</title>`,
    definition.noindex ? '<meta name="robots" content="noindex, nofollow">' : '',
    '</head>',
    `<body><div id="root" ${definition.marker}>${definition.body}</div></body>`,
    '</html>',
  ].join('');
}
