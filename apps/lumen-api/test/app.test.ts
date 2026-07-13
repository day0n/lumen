import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiApp } from '../src/app.ts';
import { resolveRequestLocale } from '../src/http/locale.ts';

test('healthz exposes the release and preserves a safe request id', async () => {
  const app = createApiApp({ release: 'abc123' });
  const response = await app.request('/healthz', {
    headers: { 'x-request-id': 'request-123' },
  });

  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-request-id'), 'request-123');
  const payload = (await response.json()) as {
    ok: boolean;
    service: string;
    release: string;
    ts: number;
  };
  assert.equal(payload.ok, true);
  assert.equal(payload.service, 'lumen-api');
  assert.equal(payload.release, 'abc123');
  assert.equal(typeof payload.ts, 'number');
});

test('readyz returns 503 when any dependency is unavailable', async () => {
  const app = createApiApp({ readiness: () => ({ mongo: true, redis: false }) });
  const response = await app.request('/readyz');
  const payload = (await response.json()) as { ok: boolean; checks: Record<string, boolean> };

  assert.equal(response.status, 503);
  assert.equal(payload.ok, false);
  assert.deepEqual(payload.checks, { mongo: true, redis: false });
});

test('request locale follows header, query, cookie, referer and browser preference order', () => {
  assert.equal(
    resolveRequestLocale(
      new Request('https://lumen.local/api/projects?locale=en', {
        headers: {
          'x-lumen-locale': 'zh',
          cookie: 'lumen_locale=en',
        },
      }),
    ),
    'zh',
  );
  assert.equal(
    resolveRequestLocale(
      new Request('https://lumen.local/api/projects', {
        headers: { cookie: 'lumen_locale=zh' },
      }),
    ),
    'zh',
  );
  assert.equal(
    resolveRequestLocale(
      new Request('https://lumen.local/api/projects', {
        headers: { referer: 'https://lumen.local/zh/share/example' },
      }),
    ),
    'zh',
  );
  assert.equal(
    resolveRequestLocale(
      new Request('https://lumen.local/api/projects', {
        headers: {
          referer: 'https://lumen.local/app/projects',
          'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        },
      }),
    ),
    'zh',
  );
});
