/**
 * 爆款复刻 Redis channel / stream 常量。
 * 勿加 server-only：server.ts 经 eventMirror 在进程启动时加载。
 */
export const REMAKE_TASKS_STREAM = 'lumen:remake:tasks';
export const REMAKE_TASKS_GROUP = 'remake-engine-group';
export const REMAKE_TASK_RESULTS_CHANNEL = 'lumen:remake:task-results';
export const REMAKE_CANCEL_KEY_PREFIX = 'lumen:remake:cancel:';
export const REMAKE_CANCEL_CHANNEL = 'lumen:remake:cancels';
export const REMAKE_CANCEL_TTL_SECONDS = 60 * 60;

export function jobEventChannel(jobId: string): string {
  return `lumen:remake:events:${jobId}`;
}

export function jobEventLogKey(jobId: string): string {
  return `lumen:remake:events:${jobId}:log`;
}
