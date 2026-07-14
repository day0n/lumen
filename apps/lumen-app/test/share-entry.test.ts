import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ShareRequestError,
  parseSharePathname,
  requestShareClone,
  requestSharePreview,
  waitForShareToken,
} from '../src/features/share/ShareEntry';

const SHARE_ID = '0123456789abcdef0123456789abcdef';

test('share routes accept only canonical lowercase IDs with an optional trailing slash', () => {
  assert.deepEqual(parseSharePathname(`/share/${SHARE_ID}`), {
    locale: 'en',
    shareId: SHARE_ID,
  });
  assert.deepEqual(parseSharePathname(`/zh/share/${SHARE_ID}/`), {
    locale: 'zh',
    shareId: SHARE_ID,
  });

  for (const pathname of [
    `/share/${SHARE_ID.toUpperCase()}`,
    `/share/${SHARE_ID}/extra`,
    `/en/share/${SHARE_ID}`,
    '/share/../app',
  ]) {
    assert.equal(parseSharePathname(pathname), null);
  }
});

test('share preview stays anonymous and cacheable while sending the resolved locale', async () => {
  let receivedInput: RequestInfo | URL | undefined;
  let receivedInit: RequestInit | undefined;
  const request = async (input: RequestInfo | URL, init?: RequestInit) => {
    receivedInput = input;
    receivedInit = init;
    return Response.json({ ok: true, data: { preview: { title: 'Launch workflow' } } });
  };

  const preview = await requestSharePreview(SHARE_ID, 'zh', request);

  assert.deepEqual(preview, { title: 'Launch workflow' });
  assert.equal(receivedInput, `/api/shares/${SHARE_ID}`);
  assert.equal(receivedInit?.credentials, 'omit');
  assert.equal(receivedInit?.method, undefined);
  assert.equal(receivedInit && 'cache' in receivedInit, false);
  assert.equal(new Headers(receivedInit?.headers).get('x-lumen-locale'), 'zh');
  assert.equal(new Headers(receivedInit?.headers).has('authorization'), false);
});

test('share preview rejects missing shares and malformed success envelopes', async () => {
  await assert.rejects(
    requestSharePreview(SHARE_ID, 'en', async () => Response.json({ ok: false }, { status: 404 })),
    (error: unknown) => error instanceof ShareRequestError && error.status === 404,
  );

  await assert.rejects(
    requestSharePreview(SHARE_ID, 'en', async () =>
      Response.json({ ok: false, data: { preview: { title: 'Ignored' } } }),
    ),
    (error: unknown) => error instanceof ShareRequestError && error.status === 502,
  );
});

test('share clone uses an explicit bearer token and never sends cookies', async () => {
  let receivedInput: RequestInfo | URL | undefined;
  let receivedInit: RequestInit | undefined;
  const request = async (input: RequestInfo | URL, init?: RequestInit) => {
    receivedInput = input;
    receivedInit = init;
    return Response.json({
      ok: true,
      data: { projectId: 'project_123', created: true },
    });
  };

  const clone = await requestShareClone(SHARE_ID, 'session-token', 'en', request);

  assert.deepEqual(clone, { projectId: 'project_123', created: true });
  assert.equal(receivedInput, `/api/shares/${SHARE_ID}/clone`);
  assert.equal(receivedInit?.method, 'POST');
  assert.equal(receivedInit?.cache, 'no-store');
  assert.equal(receivedInit?.credentials, 'omit');
  assert.equal(new Headers(receivedInit?.headers).get('authorization'), 'Bearer session-token');
  assert.equal(new Headers(receivedInit?.headers).get('x-lumen-locale'), 'en');
});

test('share requests reject invalid IDs, sessions, and clone payloads', async () => {
  let requestCount = 0;
  const request = async () => {
    requestCount += 1;
    return Response.json({ ok: true, data: { projectId: '../unsafe', created: true } });
  };

  await assert.rejects(
    requestSharePreview('../unsafe', 'en', request),
    (error: unknown) => error instanceof ShareRequestError && error.status === 400,
  );
  await assert.rejects(
    requestShareClone(SHARE_ID, '', 'en', request),
    (error: unknown) => error instanceof ShareRequestError && error.status === 401,
  );
  assert.equal(requestCount, 0);

  await assert.rejects(
    requestShareClone(SHARE_ID, 'session-token', 'en', request),
    (error: unknown) => error instanceof ShareRequestError && error.status === 502,
  );
  assert.equal(requestCount, 1);
});

test('share token lookup resolves normally or stops when the clone deadline expires', async () => {
  const activeController = new AbortController();
  assert.equal(
    await waitForShareToken(async () => 'session-token', activeController.signal),
    'session-token',
  );

  const expiredController = new AbortController();
  const pendingToken = waitForShareToken(
    () => new Promise<string | null>(() => undefined),
    expiredController.signal,
  );
  expiredController.abort();
  await assert.rejects(pendingToken, /timed out/);
});
