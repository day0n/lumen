import type { TraceStep } from './home-query-service.js';
import {
  type RemakeJobStageSource,
  type RemakeStageName,
  type RemakeStageStatus,
  type RemakeTaskStageSource,
  deriveRemakeJobStageStatuses,
} from './remake-stage-status.js';

export interface RemakeJobQueryJobLike extends RemakeJobStageSource {
  id: string;
  ownerId: string;
}

export interface RemakeJobQueryTaskLike extends RemakeTaskStageSource {
  jobId: string;
}

export interface RemakeJobQueryRepositoryPort<
  TJob extends RemakeJobQueryJobLike,
  TTask extends RemakeJobQueryTaskLike,
> {
  getJob(jobId: string, ownerId: string): Promise<TJob | null>;
  listTasksByJob(jobId: string): Promise<TTask[]>;
}

export interface RemakeJobView<
  TJob extends RemakeJobQueryJobLike,
  TTask extends RemakeJobQueryTaskLike,
> {
  job: TJob;
  tasks: TTask[];
  stageStatuses: Record<RemakeStageName, RemakeStageStatus>;
}

export interface RemakeJobQueryService<
  TJob extends RemakeJobQueryJobLike,
  TTask extends RemakeJobQueryTaskLike,
> {
  getJobView(actorUserId: string, jobId: string): Promise<RemakeJobView<TJob, TTask> | null>;
}

export interface CreateRemakeJobQueryServiceOptions<
  TJob extends RemakeJobQueryJobLike,
  TTask extends RemakeJobQueryTaskLike,
> {
  getRepository: () =>
    | RemakeJobQueryRepositoryPort<TJob, TTask>
    | Promise<RemakeJobQueryRepositoryPort<TJob, TTask>>;
  trace?: TraceStep;
  tracePrefix: string;
}

export function createRemakeJobQueryService<
  TJob extends RemakeJobQueryJobLike,
  TTask extends RemakeJobQueryTaskLike,
>(options: CreateRemakeJobQueryServiceOptions<TJob, TTask>): RemakeJobQueryService<TJob, TTask> {
  const trace: TraceStep = options.trace ?? (async (_name, _operation, callback) => callback());

  return {
    async getJobView(actorUserId, jobId) {
      assertNonBlank(actorUserId, 'actorUserId');
      if (!jobId.trim()) return null;

      const repository = await trace(
        `${options.tracePrefix}.remake.jobs.detail.repository`,
        'db.connect',
        options.getRepository,
      );
      const job = await trace(
        `${options.tracePrefix}.remake.jobs.detail.job`,
        'db.query',
        () => repository.getJob(jobId, actorUserId),
        { job_id: jobId },
      );
      if (!job) return null;
      if (job.id !== jobId || job.ownerId !== actorUserId) {
        throw new Error('Remake job repository crossed the requested identity boundary');
      }

      const tasks = await trace(
        `${options.tracePrefix}.remake.jobs.detail.tasks`,
        'db.query',
        () => repository.listTasksByJob(jobId),
        { job_id: jobId },
      );
      if (tasks.some((task) => task.jobId !== jobId)) {
        throw new Error('Remake task repository crossed the requested job boundary');
      }

      return {
        job,
        tasks,
        stageStatuses: deriveRemakeJobStageStatuses(job, tasks),
      };
    },
  };
}

function assertNonBlank(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}
