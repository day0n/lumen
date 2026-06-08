import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PublicWorkflowError,
  classifyMediaModelError,
  executeMediaModelWithRetry,
} from './model-errors.js';

test('classifyMediaModelError maps real-person provider messages to 4007', () => {
  for (const message of [
    'input image may contain real person',
    'PrivacyInformation detected in input image',
    'InputImageSensitiveContentDetected',
  ]) {
    const classified = classifyMediaModelError(new Error(message));
    assert.equal(classified.errorCode, 4007);
    assert.equal(classified.errorName, 'real_person_detected');
  }
});

test('classifyMediaModelError maps safety review messages to 3005', () => {
  for (const message of [
    'content safety check failed',
    'blocked by safety filter',
    'moderation did not approve this request',
    'violates policy',
    '审核未通过',
  ]) {
    const classified = classifyMediaModelError(new Error(message));
    assert.equal(classified.errorCode, 3005);
    assert.equal(classified.errorName, 'content_blocked');
  }
});

test('classifyMediaModelError prefers real-person over generic sensitive content', () => {
  const classified = classifyMediaModelError(
    new Error('sensitive content: input image may contain real person'),
  );

  assert.equal(classified.errorCode, 4007);
  assert.equal(classified.errorName, 'real_person_detected');
});

test('executeMediaModelWithRetry retries once and returns the second successful result', async () => {
  let attempts = 0;

  const result = await executeMediaModelWithRetry({
    nodeType: 'image',
    modelId: 'fake-image-model',
    execute: async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('temporary provider failure');
      return 'ok';
    },
  });

  assert.equal(result, 'ok');
  assert.equal(attempts, 2);
});

test('executeMediaModelWithRetry throws a public error after two failed attempts', async () => {
  let attempts = 0;

  await assert.rejects(
    () =>
      executeMediaModelWithRetry({
        nodeType: 'video',
        modelId: 'fake-video-model',
        execute: async () => {
          attempts += 1;
          throw new Error('temporary provider failure');
        },
      }),
    (error) => {
      assert.ok(error instanceof PublicWorkflowError);
      assert.equal(error.errorCode, undefined);
      assert.equal(error.errorName, 'model_execution_failed');
      assert.equal(error.attempts, 2);
      return true;
    },
  );

  assert.equal(attempts, 2);
});

test('executeMediaModelWithRetry does not call the model when already cancelled', async () => {
  const controller = new AbortController();
  controller.abort('cancelled by test');
  let attempts = 0;

  await assert.rejects(
    () =>
      executeMediaModelWithRetry({
        nodeType: 'image',
        modelId: 'fake-image-model',
        signal: controller.signal,
        execute: async () => {
          attempts += 1;
          return 'ok';
        },
      }),
    /cancelled by test/,
  );

  assert.equal(attempts, 0);
});
