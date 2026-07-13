import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type RemakeTaskStageSource,
  deriveRemakeJobStageStatuses,
  deriveRemakeStageStatus,
} from '../src/index.ts';

const task = (
  stage: RemakeTaskStageSource['stage'],
  status: RemakeTaskStageSource['status'],
): RemakeTaskStageSource => ({ stage, status });

test('remake stage status preserves task-state precedence', () => {
  assert.equal(deriveRemakeStageStatus([]), 'ready');
  assert.equal(deriveRemakeStageStatus([task('lock', 'success')]), 'success');
  assert.equal(deriveRemakeStageStatus([task('lock', 'cancelled')]), 'cancelled');
  assert.equal(
    deriveRemakeStageStatus([task('lock', 'cancelled'), task('lock', 'error')]),
    'error',
  );
  assert.equal(deriveRemakeStageStatus([task('lock', 'error'), task('lock', 'queued')]), 'running');
  assert.equal(
    deriveRemakeStageStatus([task('lock', 'cancelled'), task('lock', 'running')]),
    'running',
  );
});

test('remake job stage status keeps downstream stages locked before gate one', () => {
  assert.deepEqual(
    deriveRemakeJobStageStatuses({}, [
      task('lock', 'success'),
      task('storyboard', 'success'),
      task('video', 'success'),
      task('final', 'success'),
    ]),
    {
      breakdown: 'success',
      script: 'ready',
      lock: 'locked',
      storyboard: 'locked',
      video: 'locked',
      final: 'locked',
    },
  );
});

test('remake job stage status preserves gate and task progression', () => {
  assert.deepEqual(
    deriveRemakeJobStageStatuses(
      {
        gate1ConfirmedAt: '2026-07-14T00:00:00.000Z',
        gate2ConfirmedAt: '2026-07-14T00:01:00.000Z',
      },
      [
        task('lock', 'success'),
        task('storyboard', 'error'),
        task('video', 'success'),
        task('final', 'running'),
      ],
    ),
    {
      breakdown: 'success',
      script: 'success',
      lock: 'success',
      storyboard: 'success',
      video: 'success',
      final: 'running',
    },
  );
});

test('remake job stage status locks dependants after an upstream failure', () => {
  assert.deepEqual(
    deriveRemakeJobStageStatuses({ gate1ConfirmedAt: '2026-07-14T00:00:00.000Z' }, [
      task('lock', 'error'),
      task('storyboard', 'running'),
      task('video', 'success'),
    ]),
    {
      breakdown: 'success',
      script: 'success',
      lock: 'error',
      storyboard: 'locked',
      video: 'locked',
      final: 'locked',
    },
  );
});

test('remake storyboard follows tasks until gate two is confirmed', () => {
  assert.deepEqual(
    deriveRemakeJobStageStatuses({ gate1ConfirmedAt: '2026-07-14T00:00:00.000Z' }, [
      task('lock', 'success'),
      task('storyboard', 'running'),
      task('video', 'success'),
    ]),
    {
      breakdown: 'success',
      script: 'success',
      lock: 'success',
      storyboard: 'running',
      video: 'locked',
      final: 'locked',
    },
  );
});

test('remake gate two cannot bypass an unfinished lock stage', () => {
  assert.deepEqual(
    deriveRemakeJobStageStatuses(
      {
        gate1ConfirmedAt: '2026-07-14T00:00:00.000Z',
        gate2ConfirmedAt: '2026-07-14T00:01:00.000Z',
      },
      [task('lock', 'error'), task('storyboard', 'success')],
    ),
    {
      breakdown: 'success',
      script: 'success',
      lock: 'error',
      storyboard: 'locked',
      video: 'locked',
      final: 'locked',
    },
  );

  assert.equal(
    deriveRemakeJobStageStatuses({ gate1ConfirmedAt: '2026-07-14T00:00:00.000Z' }, []).lock,
    'ready',
  );
});
