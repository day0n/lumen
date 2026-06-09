// 勿加 server-only：server.ts 经 eventMirror 在进程启动时加载本模块。
import type { RemakeTaskStatus } from '@lumen/db';

import { getRemakeJobRepository } from '@/server/db';

import {
  deriveJobStageStatuses,
  parseEnvironmentIndexFromSliceKey,
  parseSceneIndexFromSliceKey,
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
  const previous = await repository.getTask(input.taskId);
  const task = await repository.patchTaskStatus(input.taskId, {
    status: input.status,
    progress: input.progress,
    outputUrl: input.outputUrl,
    outputKind: input.outputKind,
    error: input.error ?? null,
  });
  if (!task) return;

  // Progress short-circuit: a `running → running` event with only a progress
  // bump should not re-derive the whole stage. Video/BGM tasks emit several
  // progress events per second; the previous code re-read every task in the
  // job and rewrote the stage state for each one, multiplying mongo IO and
  // amplifying the stage race.
  const statusUnchanged = previous?.status === input.status;
  if (input.status === 'running' && statusUnchanged) {
    return;
  }

  if (input.status === 'success' && input.outputUrl) {
    await applyTaskOutputToJob(input.jobId, input.ownerId, task.sliceKey, input.outputUrl);
  }

  const job = await repository.getJob(input.jobId, input.ownerId);
  if (!job) return;
  const allTasks = await repository.listTasksByJob(input.jobId);
  const stageStatuses = deriveJobStageStatuses(job, allTasks);
  // Use the guarded stage update so concurrent task:done events cannot
  // overwrite a `success` (final) state with `running`. Without this, when
  // two tasks settle within milliseconds of each other, the lagging derive
  // sees the other one still running, and clobbers the leading success
  // write — leaving the stage stuck in running with no UI recovery path.
  await repository.patchStageGuarded(input.jobId, input.ownerId, task.stage, {
    status: stageStatuses[task.stage],
    ...(stageStatuses[task.stage] === 'success' ? { settledAt: new Date() } : {}),
  });
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

  if (field === 'environmentLockUrl') {
    const environmentIndex = parseEnvironmentIndexFromSliceKey(sliceKey);
    if (environmentIndex === null) return;
    await repository.patchEnvironmentOutput(jobId, ownerId, environmentIndex, outputUrl);
    return;
  }

  const sceneIndex = parseSceneIndexFromSliceKey(sliceKey);
  if (sceneIndex === null) return;
  await repository.patchSceneOutput(jobId, ownerId, sceneIndex, { [field]: outputUrl });
}
