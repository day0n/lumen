export type RemakeStageName = 'breakdown' | 'script' | 'lock' | 'storyboard' | 'video' | 'final';

export type RemakeStageStatus = 'locked' | 'ready' | 'running' | 'success' | 'error' | 'cancelled';

export type RemakeTaskStatus = 'queued' | 'running' | 'success' | 'error' | 'cancelled';

export interface RemakeJobStageSource {
  gate1ConfirmedAt?: string;
  gate2ConfirmedAt?: string;
}

export interface RemakeTaskStageSource {
  stage: RemakeStageName;
  status: RemakeTaskStatus;
}

export function deriveRemakeStageStatus(
  tasks: readonly RemakeTaskStageSource[],
): RemakeStageStatus {
  if (tasks.length === 0) return 'ready';

  let anyRunning = false;
  let anyError = false;
  let anyCancelled = false;
  let allSuccess = true;
  for (const task of tasks) {
    if (task.status === 'queued' || task.status === 'running') {
      anyRunning = true;
      allSuccess = false;
    } else if (task.status === 'error') {
      anyError = true;
      allSuccess = false;
    } else if (task.status === 'cancelled') {
      anyCancelled = true;
      allSuccess = false;
    }
  }

  if (anyRunning) return 'running';
  if (allSuccess) return 'success';
  if (anyError) return 'error';
  if (anyCancelled) return 'cancelled';
  return 'ready';
}

export function deriveRemakeJobStageStatuses(
  job: RemakeJobStageSource,
  tasks: readonly RemakeTaskStageSource[],
): Record<RemakeStageName, RemakeStageStatus> {
  const byStage = new Map<RemakeStageName, RemakeTaskStageSource[]>();
  for (const task of tasks) {
    const stageTasks = byStage.get(task.stage) ?? [];
    stageTasks.push(task);
    byStage.set(task.stage, stageTasks);
  }
  const tasksOf = (stage: RemakeStageName) => byStage.get(stage) ?? [];

  const breakdown: RemakeStageStatus = 'success';
  const script: RemakeStageStatus = job.gate1ConfirmedAt ? 'success' : 'ready';

  const lockTasks = tasksOf('lock');
  const lockStatus = lockTasks.length > 0 ? deriveRemakeStageStatus(lockTasks) : 'ready';
  const lock: RemakeStageStatus = job.gate1ConfirmedAt ? lockStatus : 'locked';

  const storyboardTasks = tasksOf('storyboard');
  const storyboardComputed =
    storyboardTasks.length > 0 ? deriveRemakeStageStatus(storyboardTasks) : 'ready';
  const storyboard: RemakeStageStatus =
    lock !== 'success' ? 'locked' : job.gate2ConfirmedAt ? 'success' : storyboardComputed;

  const videoTasks = tasksOf('video');
  const videoComputed = videoTasks.length > 0 ? deriveRemakeStageStatus(videoTasks) : 'ready';
  const video: RemakeStageStatus = storyboard !== 'success' ? 'locked' : videoComputed;

  const finalTasks = tasksOf('final');
  const finalComputed = finalTasks.length > 0 ? deriveRemakeStageStatus(finalTasks) : 'ready';
  const final: RemakeStageStatus = video !== 'success' ? 'locked' : finalComputed;

  return { breakdown, script, lock, storyboard, video, final };
}
