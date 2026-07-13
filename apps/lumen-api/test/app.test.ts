import assert from 'node:assert/strict';
import test from 'node:test';

import { type ReadinessChecks, createApiApp } from '../src/app.ts';
import {
  DEFAULT_API_READINESS_TIMEOUT_MS,
  DEFAULT_API_SHUTDOWN_TIMEOUT_MS,
  readApiConfig,
} from '../src/config.ts';
import { resolveRequestLocale } from '../src/http/locale.ts';
import { createShutdownHandler } from '../src/main.ts';

test('config keeps safe development defaults and accepts explicit deadlines', () => {
  const defaults = readApiConfig({});
  assert.equal(defaults.host, '127.0.0.1');
  assert.equal(defaults.environment, 'development');
  assert.equal(defaults.port, 3003);
  assert.equal(defaults.mongoUri, '');
  assert.equal(defaults.release, 'dev');
  assert.equal(defaults.readinessTimeoutMs, DEFAULT_API_READINESS_TIMEOUT_MS);
  assert.equal(defaults.shutdownTimeoutMs, DEFAULT_API_SHUTDOWN_TIMEOUT_MS);

  const configured = readApiConfig({
    API_PORT: '3100',
    API_READINESS_TIMEOUT_MS: '1250',
    API_SHUTDOWN_TIMEOUT_MS: '7500',
  });
  assert.equal(configured.port, 3100);
  assert.equal(configured.readinessTimeoutMs, 1250);
  assert.equal(configured.shutdownTimeoutMs, 7500);
  assert.equal(readApiConfig({ API_PORT: '', PORT: '3200' }).port, 3200);
  assert.equal(readApiConfig({ NODE_ENV: 'test' }).environment, 'test');
});

test('config rejects malformed ports and deadlines', () => {
  assert.throws(() => readApiConfig({ NODE_ENV: 'stagin' }), /NODE_ENV/);
  assert.throws(() => readApiConfig({ API_PORT: '3003junk' }), /API_PORT/);
  assert.throws(() => readApiConfig({ API_READINESS_TIMEOUT_MS: '0' }), /READINESS/);
  assert.throws(() => readApiConfig({ API_SHUTDOWN_TIMEOUT_MS: '2147483648' }), /SHUTDOWN/);
});

test('production config requires persistence and a full release SHA', () => {
  const fullSha = 'a'.repeat(40);
  assert.throws(
    () => readApiConfig({ NODE_ENV: 'production', RELEASE_SHA: fullSha }),
    /MONGODB_URI is required/,
  );
  assert.throws(
    () =>
      readApiConfig({
        NODE_ENV: 'production',
        MONGODB_URI: 'mongodb://127.0.0.1/lumen',
        RELEASE_SHA: 'abc123',
      }),
    /full commit SHA/,
  );

  const config = readApiConfig({
    NODE_ENV: 'production',
    MONGODB_URI: 'mongodb://127.0.0.1/lumen',
    GITHUB_SHA: fullSha,
  });
  assert.equal(config.mongoUri, 'mongodb://127.0.0.1/lumen');
  assert.equal(config.release, fullSha);
});

test('shutdown is single-flight and drains the server before the runtime', async () => {
  const events: string[] = [];
  const exitCodes: number[] = [];
  const server = {
    close: (callback: (error?: Error) => void) => {
      events.push('server');
      callback();
      return server;
    },
  } as unknown as Parameters<typeof createShutdownHandler>[0]['server'];
  const shutdown = createShutdownHandler({
    closeRuntime: async () => {
      events.push('runtime');
    },
    forceExit: (code) => {
      exitCodes.push(code);
    },
    logger: { error: () => {}, info: () => {} },
    server,
    timeoutMs: 100,
  });

  const first = shutdown('SIGTERM');
  const second = shutdown('SIGINT');
  assert.equal(first, second);
  await first;

  assert.deepEqual(events, ['server', 'runtime']);
  assert.deepEqual(exitCodes, []);
});

test('shutdown force closes and exits when graceful cleanup fails', async () => {
  const events: string[] = [];
  const exitCodes: number[] = [];
  const recordedExitCodes: number[] = [];
  const loggedErrors: unknown[] = [];
  const server = {
    close: (callback: (error?: Error) => void) => {
      events.push('server');
      callback(new Error('server close failed'));
      return server;
    },
    closeAllConnections: () => {
      events.push('force-close');
    },
  } as unknown as Parameters<typeof createShutdownHandler>[0]['server'];
  const shutdown = createShutdownHandler({
    closeRuntime: async () => {
      events.push('runtime');
      throw new Error('runtime close failed');
    },
    forceExit: (code) => {
      exitCodes.push(code);
    },
    logger: {
      error: (_message, details) => loggedErrors.push(details),
      info: () => {},
    },
    server,
    setExitCode: (code) => recordedExitCodes.push(code),
    timeoutMs: 100,
  });

  await shutdown('SIGTERM');

  assert.deepEqual(events, ['server', 'runtime', 'force-close']);
  assert.deepEqual(recordedExitCodes, [1]);
  assert.deepEqual(exitCodes, [1]);
  assert.equal(loggedErrors.length, 1);
  const loggedError = (loggedErrors[0] as { error?: unknown }).error;
  assert.ok(loggedError instanceof AggregateError);
  assert.equal(loggedError.errors.length, 2);
});

test('shutdown forces exit at its deadline', { timeout: 500 }, async () => {
  let forceCloseCalls = 0;
  const exitCodes: number[] = [];
  const server = {
    close: () => server,
    closeAllConnections: () => {
      forceCloseCalls += 1;
    },
  } as unknown as Parameters<typeof createShutdownHandler>[0]['server'];
  const shutdown = createShutdownHandler({
    closeRuntime: async () => {},
    forceExit: (code) => {
      exitCodes.push(code);
    },
    logger: { error: () => {}, info: () => {} },
    server,
    timeoutMs: 15,
  });

  await shutdown('SIGTERM');

  assert.equal(forceCloseCalls, 1);
  assert.deepEqual(exitCodes, [1]);
});

test('healthz exposes the release and preserves a safe request id', async () => {
  const app = createApiApp({ release: 'abc123' });
  const response = await app.request('/healthz', {
    headers: { 'x-request-id': 'request-123' },
  });

  assert.equal(response.status, 200);
  assertProbeHeaders(response, 'abc123');
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
  const app = createApiApp({
    readiness: () => ({ mongo: true, redis: false }),
    release: 'ready-release',
  });
  const response = await app.request('/readyz', {
    headers: { 'x-request-id': 'ready-request' },
  });
  const payload = (await response.json()) as { ok: boolean; checks: Record<string, boolean> };

  assert.equal(response.status, 503);
  assertProbeHeaders(response, 'ready-release');
  assert.equal(response.headers.get('x-request-id'), 'ready-request');
  assert.equal(payload.ok, false);
  assert.deepEqual(payload.checks, { mongo: true, redis: false });
});

test(
  'readyz returns a diagnostic 503 when readiness exceeds its deadline',
  { timeout: 500 },
  async () => {
    const app = createApiApp({
      readiness: () => new Promise<ReadinessChecks>(() => {}),
      readinessTimeoutMs: 15,
      requiredReadinessChecks: ['mongo'],
    });
    const response = await app.request('/readyz');
    const payload = (await response.json()) as { ok: boolean; checks: ReadinessChecks };

    assert.equal(response.status, 503);
    assertProbeHeaders(response, 'dev');
    assert.equal(payload.ok, false);
    assert.deepEqual(payload.checks, { readinessDeadline: false });
  },
);

test('readyz distinguishes readiness execution failures', async () => {
  const app = createApiApp({
    readiness: () => {
      throw new Error('probe failed');
    },
  });
  const response = await app.request('/readyz');
  const payload = (await response.json()) as { ok: boolean; checks: ReadinessChecks };

  assert.equal(response.status, 503);
  assertProbeHeaders(response, 'dev');
  assert.deepEqual(payload.checks, { readinessExecution: false });
});

test('readyz can treat an unavailable cache as optional', async () => {
  const app = createApiApp({
    readiness: () => ({ mongo: true, redis: false }),
    requiredReadinessChecks: ['mongo'],
  });
  const response = await app.request('/readyz');

  assert.equal(response.status, 200);
  assertProbeHeaders(response, 'dev');
});

test('home routes preserve response envelopes and request locale', async () => {
  const locales: string[] = [];
  const app = createApiApp({
    homeQueries: {
      async listFeatured(locale) {
        locales.push(locale);
        return [{ id: 'featured-1' }];
      },
      async listTemplates(locale) {
        locales.push(locale);
        return { categories: [], items: [{ id: 'template-1' }] };
      },
    },
  });

  const featuredResponse = await app.request('/api/home/featured', {
    headers: { 'x-lumen-locale': 'zh' },
  });
  assert.equal(featuredResponse.status, 200);
  assert.deepEqual(await featuredResponse.json(), {
    ok: true,
    data: { items: [{ id: 'featured-1' }] },
  });

  const templatesResponse = await app.request('/api/home/templates?locale=en');
  assert.equal(templatesResponse.status, 200);
  assert.deepEqual(await templatesResponse.json(), {
    ok: true,
    data: { categories: [], items: [{ id: 'template-1' }] },
  });
  assert.deepEqual(locales, ['zh', 'en']);
});

test('home routes localize service failures', async () => {
  const app = createApiApp();
  const response = await app.request('/api/home/featured', {
    headers: { 'x-lumen-locale': 'zh' },
  });

  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), {
    ok: false,
    error: { message: '服务暂时不可用' },
  });
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

function assertProbeHeaders(response: Response, release: string) {
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.match(response.headers.get('content-type') ?? '', /^application\/json\b/);
  assert.match(response.headers.get('x-request-id') ?? '', /^[A-Za-z0-9._:-]{1,128}$/);
  assert.equal(response.headers.get('x-lumen-release'), release);
}
