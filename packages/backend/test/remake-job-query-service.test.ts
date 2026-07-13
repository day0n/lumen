import assert from 'node:assert/strict';
import test from 'node:test';

import {
  type RemakeJobQueryJobLike,
  type RemakeJobQueryTaskLike,
  createRemakeJobQueryService,
} from '../src/index.ts';

interface TestJob extends RemakeJobQueryJobLike {
  label: string;
}

interface TestTask extends RemakeJobQueryTaskLike {
  id: string;
}

const job: TestJob = {
  gate1ConfirmedAt: '2026-07-14T00:00:00.000Z',
  id: 'job-1',
  label: 'Owned job',
  ownerId: 'user-1',
};

const tasks: TestTask[] = [
  { id: 'task-1', jobId: job.id, stage: 'lock', status: 'success' },
  { id: 'task-2', jobId: job.id, stage: 'storyboard', status: 'running' },
];

test('remake detail reads the owned job before ordered tasks and composes its view', async () => {
  const calls: string[] = [];
  const service = createRemakeJobQueryService({
    getRepository: async () => ({
      async getJob(jobId, ownerId) {
        calls.push(`job:${jobId}:${ownerId}`);
        return job;
      },
      async listTasksByJob(jobId) {
        calls.push(`tasks:${jobId}`);
        return tasks;
      },
    }),
    tracePrefix: 'test',
  });

  assert.deepEqual(await service.getJobView('user-1', 'job-1'), {
    job,
    tasks,
    stageStatuses: {
      breakdown: 'success',
      script: 'success',
      lock: 'success',
      storyboard: 'running',
      video: 'locked',
      final: 'locked',
    },
  });
  assert.deepEqual(calls, ['job:job-1:user-1', 'tasks:job-1']);
});

test('remake detail never reads unowned job tasks', async () => {
  let taskCalls = 0;
  const service = createRemakeJobQueryService<TestJob, TestTask>({
    getRepository: async () => ({
      async getJob() {
        return null;
      },
      async listTasksByJob() {
        taskCalls += 1;
        return tasks;
      },
    }),
    tracePrefix: 'test',
  });

  assert.equal(await service.getJobView('user-1', 'missing'), null);
  assert.equal(taskCalls, 0);
});

test('remake detail fails closed on repository identity boundary violations', async () => {
  let taskCalls = 0;
  const wrongJobService = createRemakeJobQueryService<TestJob, TestTask>({
    getRepository: async () => ({
      async getJob() {
        return { ...job, ownerId: 'user-2' };
      },
      async listTasksByJob() {
        taskCalls += 1;
        return tasks;
      },
    }),
    tracePrefix: 'test',
  });
  await assert.rejects(
    wrongJobService.getJobView('user-1', 'job-1'),
    /job repository crossed the requested identity boundary/,
  );
  assert.equal(taskCalls, 0);

  const wrongIdService = createRemakeJobQueryService<TestJob, TestTask>({
    getRepository: async () => ({
      async getJob() {
        return { ...job, id: 'job-2' };
      },
      async listTasksByJob() {
        taskCalls += 1;
        return tasks;
      },
    }),
    tracePrefix: 'test',
  });
  await assert.rejects(
    wrongIdService.getJobView('user-1', 'job-1'),
    /job repository crossed the requested identity boundary/,
  );
  assert.equal(taskCalls, 0);

  const wrongTaskService = createRemakeJobQueryService<TestJob, TestTask>({
    getRepository: async () => ({
      async getJob() {
        return job;
      },
      async listTasksByJob() {
        return [{ ...tasks[0], jobId: 'job-2' }];
      },
    }),
    tracePrefix: 'test',
  });
  await assert.rejects(
    wrongTaskService.getJobView('user-1', 'job-1'),
    /task repository crossed the requested job boundary/,
  );
});

test('remake detail rejects blank actors and treats blank job ids as missing', async () => {
  let repositoryCalls = 0;
  const service = createRemakeJobQueryService<TestJob, TestTask>({
    getRepository: async () => {
      repositoryCalls += 1;
      return {
        async getJob() {
          return job;
        },
        async listTasksByJob() {
          return tasks;
        },
      };
    },
    tracePrefix: 'test',
  });

  await assert.rejects(service.getJobView(' ', 'job-1'), /actorUserId is required/);
  assert.equal(await service.getJobView('user-1', ' '), null);
  assert.equal(repositoryCalls, 0);
});

test('remake detail preserves repository failures and stops later reads', async () => {
  const repositoryFailure = new Error('repository failed');
  const repositoryFailingService = createRemakeJobQueryService<TestJob, TestTask>({
    getRepository: async () => {
      throw repositoryFailure;
    },
    tracePrefix: 'test',
  });
  await assert.rejects(
    repositoryFailingService.getJobView('user-1', 'job-1'),
    (error) => error === repositoryFailure,
  );

  const failure = new Error('job query failed');
  let taskCalls = 0;
  const service = createRemakeJobQueryService<TestJob, TestTask>({
    getRepository: async () => ({
      async getJob() {
        throw failure;
      },
      async listTasksByJob() {
        taskCalls += 1;
        return tasks;
      },
    }),
    tracePrefix: 'test',
  });

  await assert.rejects(service.getJobView('user-1', 'job-1'), (error) => error === failure);
  assert.equal(taskCalls, 0);

  const taskFailure = new Error('task query failed');
  const taskFailingService = createRemakeJobQueryService<TestJob, TestTask>({
    getRepository: async () => ({
      async getJob() {
        return job;
      },
      async listTasksByJob() {
        throw taskFailure;
      },
    }),
    tracePrefix: 'test',
  });
  await assert.rejects(
    taskFailingService.getJobView('user-1', 'job-1'),
    (error) => error === taskFailure,
  );
});
