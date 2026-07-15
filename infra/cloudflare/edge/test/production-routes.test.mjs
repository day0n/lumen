import assert from 'node:assert/strict';
import test from 'node:test';

import { removeProductionRoutes } from '../scripts/remove-production-routes.mjs';

const ZONE_ID = '0123456789abcdef0123456789abcdef';
const WORKER = 'lumen-frontend-edge-production';

test('removes only the expected production frontend routes and verifies the result', async () => {
  const calls = [];
  let listCount = 0;
  const result = await removeProductionRoutes({
    apiToken: 'token',
    fetchImpl: async (url, init) => {
      calls.push({ authorization: init.headers.authorization, method: init.method ?? 'GET', url });
      if ((init.method ?? 'GET') === 'DELETE') {
        return Response.json({ success: true, result: { id: url.split('/').at(-1) } });
      }
      listCount += 1;
      return Response.json({
        success: true,
        result:
          listCount === 1
            ? [
                { id: 'route-1', pattern: 'lumenstudio.tech/*', script: WORKER },
                { id: 'route-2', pattern: 'www.lumenstudio.tech/*', script: WORKER },
                { id: 'route-3', pattern: 'api.lumenstudio.tech/*', script: 'api-worker' },
              ]
            : [{ id: 'route-3', pattern: 'api.lumenstudio.tech/*', script: 'api-worker' }],
      });
    },
    zoneId: ZONE_ID,
  });

  assert.deepEqual(result, {
    removed: ['lumenstudio.tech/*', 'www.lumenstudio.tech/*'],
    verified: true,
    worker: WORKER,
  });
  assert.deepEqual(
    calls.map((call) => call.method),
    ['GET', 'DELETE', 'DELETE', 'GET'],
  );
  assert.equal(
    calls.every((call) => call.authorization === 'Bearer token'),
    true,
  );
  assert.match(calls[1].url, /\/route-1$/);
  assert.match(calls[2].url, /\/route-2$/);
});

test('refuses unexpected ownership without deleting routes', async () => {
  for (const route of [
    { id: 'route-1', pattern: 'lumenstudio.tech/private/*', script: WORKER },
    { id: 'route-2', pattern: 'lumenstudio.tech/*', script: 'another-worker' },
  ]) {
    const methods = [];
    await assert.rejects(
      removeProductionRoutes({
        apiToken: 'token',
        fetchImpl: async (_url, init) => {
          methods.push(init.method ?? 'GET');
          return Response.json({ success: true, result: [route] });
        },
        zoneId: ZONE_ID,
      }),
      route.script === WORKER ? /unexpected route/ : /owned by another worker/,
    );
    assert.deepEqual(methods, ['GET']);
  }
});

test('rejects invalid credentials and malformed route responses', async () => {
  await assert.rejects(
    removeProductionRoutes({ apiToken: '', zoneId: ZONE_ID }),
    /CLOUDFLARE_API_TOKEN is required/,
  );
  await assert.rejects(
    removeProductionRoutes({ apiToken: 'token', zoneId: 'short' }),
    /CLOUDFLARE_ZONE_ID/,
  );
  await assert.rejects(
    removeProductionRoutes({
      apiToken: 'token',
      fetchImpl: async () => Response.json({ success: false, errors: [] }, { status: 403 }),
      zoneId: ZONE_ID,
    }),
    /status 403/,
  );
});
