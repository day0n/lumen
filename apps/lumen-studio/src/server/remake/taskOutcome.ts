// 勿加 server-only：server.ts 经 eventMirror 在进程启动时加载本模块。
import type { RemakeTaskStatus } from '@lumen/db';

import { getRemakeJobRepository } from '@/server/db';

import { dispatchTasks } from './dispatch';
import {
  deriveJobStageStatuses,
  parseSceneIndexFromSliceKey,
  planSceneMixTask,
  sliceOutputField,
} from './stages';

export interface RecordTaskOutcomeInput {
  jobId: string;
  ownerId: string;
  taskId: string;
  status: RemakeTaskStatus;
  progress?: number;
  outputUrl?: string;
  outputKind?: 'image' | 'video' | 'audio' | 'text';
  error?: string;
}

export async function recordTaskOutcome(input: RecordTaskOutcomeInput): Promise<void> {
  const repository = await getRemakeJobRepository();
  const task = await repository.patchTaskStatus(input.taskId, {
    status: input.status,
    progress: input.progress,
    outputUrl: input.outputUrl,
    outputKind: input.outputKind,
    error: input.error ?? null,
  });
  if (!task) return;

  if (input.status === 'success' && input.outputUrl) {
    await applyTaskOutputToJob(input.jobId, input.ownerId, task.sliceKey, input.outputUrl);
  }

  const job = await repository.getJob(input.jobId, input.ownerId);
  if (!job) return;
  const allTasks = await repository.listTasksByJob(input.jobId);
  const stageStatuses = deriveJobStageStatuses(job, allTasks);
  await repository.updateJob(input.jobId, input.ownerId, {
    stagePatch: {
      name: task.stage,
      state: {
        status: stageStatuses[task.stage],
        ...(stageStatuses[task.stage] === 'success' ? { settledAt: new Date() } : {}),
      },
    },
  });

  if (
    task.stage === 'video' &&
    input.status === 'success' &&
    (task.sliceKey.startsWith('scene-video-') || task.sliceKey.startsWith('scene-voice-'))
  ) {
    await maybeEnqueueSceneMix(input.jobId, input.ownerId, task.sliceKey);
  }
}

async function applyTaskOutputToJob(
  jobId: string,
  ownerId: string,
  sliceKey: string,
  outputUrl: string,
): Promise<void> {
  const repository = await getRemakeJobRepository();
  const field = sliceOutputField(sliceKey);
  if (!field) return;

  if (
    field === 'creatorLockUrl' ||
    field === 'productLockUrl' ||
    field === 'bgmUrl' ||
    field === 'finalUrl'
  ) {
    await repository.updateJob(jobId, ownerId, {
      outputsPatch: { [field]: outputUrl },
    });
    return;
  }

  const sceneIndex = parseSceneIndexFromSliceKey(sliceKey);
  if (sceneIndex === null) return;
  await repository.patchSceneOutput(jobId, ownerId, sceneIndex, { [field]: outputUrl });
}

async function maybeEnqueueSceneMix(
  jobId: string,
  ownerId: string,
  triggerSliceKey: string,
): Promise<void> {
  const sceneIndex = parseSceneIndexFromSliceKey(triggerSliceKey);
  if (sceneIndex === null) return;

  const repository = await getRemakeJobRepository();
  const job = await repository.getJob(jobId, ownerId);
  if (!job) return;
  const mix = planSceneMixTask(job, sceneIndex);
  if (!mix) return;

  const existing = await repository
    .listTasksByJob(jobId)
    .then((tasks) => tasks.find((task) => task.sliceKey === mix.sliceKey));
  if (
    existing &&
    (existing.status === 'queued' || existing.status === 'running' || existing.status === 'success')
  ) {
    return;
  }

  const [created] = await repository.createTasks([
    {
      jobId,
      stage: mix.stage,
      sliceKey: mix.sliceKey,
      handler: mix.handler,
      input: mix.input,
      settings: mix.settings,
    },
  ]);
  if (!created) return;

  await dispatchTasks([
    {
      taskId: created.id,
      jobId,
      ownerId,
      stage: created.stage,
      sliceKey: created.sliceKey,
      handler: created.handler,
      inputJson: JSON.stringify(mix.input),
      settingsJson: JSON.stringify(mix.settings),
    },
  ]);
}
