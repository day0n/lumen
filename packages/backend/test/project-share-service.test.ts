import assert from 'node:assert/strict';
import test from 'node:test';

import { createProjectShareService, isValidProjectShareId } from '../src/project-share-service.ts';

const shareId = '0123456789abcdef0123456789abcdef';
const sourceProject = {
  id: 'source-1',
  ownerId: 'owner-1',
  title: 'Shared project',
  canvas: { nodes: [], edges: [] },
};

test('share ids accept only the persisted lowercase capability format', () => {
  assert.equal(isValidProjectShareId(shareId), true);
  for (const value of [
    '',
    '0123456789ABCDEF0123456789ABCDEF',
    '01234567-89ab-cdef-0123-456789abcdef',
    `${shareId}0`,
    '../0123456789abcdef0123456789ab',
  ]) {
    assert.equal(isValidProjectShareId(value), false, value);
  }
});

test('share previews expose only the project title', async () => {
  const service = createProjectShareService({
    getHistoryRepository: async () => ({ async ensureCreatedSnapshot() {} }),
    getProjectRepository: async () => ({
      async getByShareId(receivedShareId) {
        assert.equal(receivedShareId, shareId);
        return { ...sourceProject, secret: 'must-not-leak' };
      },
      async cloneSharedProject() {
        return null;
      },
      async markSharedProjectHistoryRecorded() {
        return true;
      },
    }),
    async invalidateProject() {},
    tracePrefix: 'test',
  });

  assert.deepEqual(await service.getPreview(shareId), { title: 'Shared project' });
  assert.equal(await service.getPreview('invalid'), null);
});

test('new share clones invalidate caches and record their initial history', async () => {
  const calls: string[] = [];
  const snapshots: unknown[] = [];
  const clone = { ...sourceProject, id: 'clone-1', ownerId: 'viewer-1' };
  const service = createProjectShareService({
    getHistoryRepository: async () => ({
      async ensureCreatedSnapshot(snapshot) {
        calls.push('history');
        snapshots.push(snapshot);
      },
    }),
    getProjectRepository: async () => ({
      async getByShareId() {
        return sourceProject;
      },
      async cloneSharedProject(ownerId, receivedShareId) {
        assert.equal(ownerId, 'viewer-1');
        assert.equal(receivedShareId, shareId);
        calls.push('clone');
        return { project: clone, created: true, historyPending: true };
      },
      async markSharedProjectHistoryRecorded(ownerId, projectId, receivedShareId) {
        assert.equal(ownerId, 'viewer-1');
        assert.equal(projectId, 'clone-1');
        assert.equal(receivedShareId, shareId);
        calls.push('mark');
        return true;
      },
    }),
    async invalidateProject(ownerId, projectId) {
      assert.equal(ownerId, 'viewer-1');
      assert.equal(projectId, 'clone-1');
      calls.push('invalidate');
    },
    tracePrefix: 'test',
  });

  assert.deepEqual(await service.cloneForOwner('viewer-1', shareId), {
    projectId: 'clone-1',
    created: true,
  });
  assert.deepEqual(calls, ['clone', 'invalidate', 'history', 'mark']);
  assert.deepEqual(snapshots, [
    {
      ownerId: 'viewer-1',
      projectId: 'clone-1',
      title: 'Shared project',
      canvas: clone.canvas,
    },
  ]);
});

test('idempotent share clone retries invalidate caches without duplicating history', async () => {
  let historyWrites = 0;
  let invalidations = 0;
  const service = createProjectShareService({
    getHistoryRepository: async () => ({
      async ensureCreatedSnapshot() {
        historyWrites += 1;
      },
    }),
    getProjectRepository: async () => ({
      async getByShareId() {
        return sourceProject;
      },
      async cloneSharedProject() {
        return {
          project: { ...sourceProject, id: 'clone-1', ownerId: 'viewer-1' },
          created: false,
          historyPending: false,
        };
      },
      async markSharedProjectHistoryRecorded() {
        throw new Error('must not mark history');
      },
    }),
    async invalidateProject() {
      invalidations += 1;
    },
    tracePrefix: 'test',
  });

  assert.deepEqual(await service.cloneForOwner('viewer-1', shareId), {
    projectId: 'clone-1',
    created: false,
  });
  assert.equal(invalidations, 1);
  assert.equal(historyWrites, 0);
});

test('share clone retries finish a pending history side effect exactly once', async () => {
  const calls: string[] = [];
  const service = createProjectShareService({
    getHistoryRepository: async () => ({
      async ensureCreatedSnapshot() {
        calls.push('history');
      },
    }),
    getProjectRepository: async () => ({
      async getByShareId() {
        return sourceProject;
      },
      async cloneSharedProject() {
        return {
          project: { ...sourceProject, id: 'clone-1', ownerId: 'viewer-1' },
          created: false,
          historyPending: true,
        };
      },
      async markSharedProjectHistoryRecorded() {
        calls.push('mark');
        return true;
      },
    }),
    async invalidateProject() {
      calls.push('invalidate');
    },
    tracePrefix: 'test',
  });

  assert.deepEqual(await service.cloneForOwner('viewer-1', shareId), {
    projectId: 'clone-1',
    created: false,
  });
  assert.deepEqual(calls, ['invalidate', 'history', 'mark']);
});

test('share clone service rejects repository ownership boundary violations', async () => {
  const service = createProjectShareService({
    getHistoryRepository: async () => ({ async ensureCreatedSnapshot() {} }),
    getProjectRepository: async () => ({
      async getByShareId() {
        return sourceProject;
      },
      async cloneSharedProject() {
        return { project: sourceProject, created: true, historyPending: true };
      },
      async markSharedProjectHistoryRecorded() {
        return true;
      },
    }),
    async invalidateProject() {
      throw new Error('must not invalidate');
    },
    tracePrefix: 'test',
  });

  await assert.rejects(
    service.cloneForOwner('viewer-1', shareId),
    /crossed the requested identity boundary/,
  );
  await assert.rejects(service.cloneForOwner('  ', shareId), /actorUserId is required/);
  assert.equal(await service.cloneForOwner('viewer-1', 'invalid'), null);
});
