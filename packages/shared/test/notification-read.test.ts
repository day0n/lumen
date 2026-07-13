import assert from 'node:assert/strict';
import test from 'node:test';

import { markNotificationReadOptimistically } from '../src/notification-read.ts';

test('notification read rolls optimistic state back after an HTTP failure', async () => {
  const states: boolean[] = [];
  const operation = markNotificationReadOptimistically('notice-1', {
    fetch: async () => new Response('failed', { status: 500 }),
    setRead: (isRead) => states.push(isRead),
  });

  assert.deepEqual(states, [true]);
  await assert.rejects(operation, /status 500/);
  assert.deepEqual(states, [true, false]);
});

test('notification read rolls optimistic state back after a network failure', async () => {
  const states: boolean[] = [];
  const failure = new Error('network unavailable');

  await assert.rejects(
    markNotificationReadOptimistically('notice-1', {
      fetch: async () => {
        throw failure;
      },
      setRead: (isRead) => states.push(isRead),
    }),
    (error: unknown) => error === failure,
  );
  assert.deepEqual(states, [true, false]);
});

test('notification read encodes the identifier and keeps successful optimistic state', async () => {
  const states: boolean[] = [];
  const requests: Array<{ init?: RequestInit; input: RequestInfo | URL }> = [];

  await markNotificationReadOptimistically('notice/中文 ?#%', {
    fetch: async (input, init) => {
      requests.push({ init, input });
      return Response.json({ data: { read: true }, ok: true });
    },
    setRead: (isRead) => states.push(isRead),
  });

  assert.deepEqual(states, [true]);
  assert.equal(
    String(requests[0]?.input),
    '/api/notifications/official/notice%2F%E4%B8%AD%E6%96%87%20%3F%23%25/read',
  );
  assert.equal(requests[0]?.init?.method, 'POST');
});

test('notification read accepts a successful no-content response', async () => {
  const states: boolean[] = [];

  await markNotificationReadOptimistically('notice-1', {
    fetch: async () => new Response(null, { status: 204 }),
    setRead: (isRead) => states.push(isRead),
  });

  assert.deepEqual(states, [true]);
});
