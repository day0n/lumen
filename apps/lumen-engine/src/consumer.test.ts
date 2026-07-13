import assert from 'node:assert/strict';
import test from 'node:test';

import type Redis from 'ioredis';

import { StreamConsumer } from './consumer.js';
import type { WorkflowStore } from './database/workflow-store.js';

test('stream consumer reserves its duplicate reader for blocking reads', async () => {
  const commandCalls: string[] = [];
  const readerCalls: string[] = [];
  const subscriberCalls: string[] = [];
  let duplicateCalls = 0;
  let stopConsumer = () => {};
  let resolveAck: (() => void) | undefined;
  const acked = new Promise<void>((resolve) => {
    resolveAck = resolve;
  });

  const subscriber = {
    disconnect() {
      subscriberCalls.push('disconnect');
    },
    on(event: string) {
      subscriberCalls.push(`on:${event}`);
      return this;
    },
    async subscribe() {
      subscriberCalls.push('subscribe');
      return 1;
    },
  } as unknown as Redis;

  const reader = {
    disconnect() {
      readerCalls.push('disconnect');
    },
    on(event: string) {
      readerCalls.push(`on:${event}`);
      return this;
    },
    async xreadgroup(...args: unknown[]) {
      readerCalls.push('xreadgroup');
      assert.deepEqual(args.slice(5, 7), ['BLOCK', '5000']);
      stopConsumer();
      return [['lumen:flow:tasks', [['message-1', []]]]];
    },
  } as unknown as Redis;

  const command = {
    duplicate() {
      duplicateCalls += 1;
      commandCalls.push(`duplicate:${duplicateCalls}`);
      if (duplicateCalls === 1) return subscriber;
      if (duplicateCalls === 2) return reader;
      throw new Error('unexpected Redis duplicate');
    },
    async xack() {
      commandCalls.push('xack');
      resolveAck?.();
      return 1;
    },
    async xautoclaim() {
      commandCalls.push('xautoclaim');
      return ['0-0', [], []];
    },
    async xgroup() {
      commandCalls.push('xgroup');
      return 'OK';
    },
  } as unknown as Redis;

  const consumer = new StreamConsumer(command, {} as WorkflowStore);
  stopConsumer = () => consumer.stop();
  await consumer.start();
  await acked;

  assert.deepEqual(commandCalls, ['xgroup', 'xautoclaim', 'duplicate:1', 'duplicate:2', 'xack']);
  assert.deepEqual(readerCalls, ['on:error', 'xreadgroup', 'disconnect']);
  assert.deepEqual(subscriberCalls, ['on:error', 'on:message', 'subscribe', 'disconnect']);
});
