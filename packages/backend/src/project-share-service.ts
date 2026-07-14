import type { TraceStep } from './home-query-service.js';

export interface SharedProjectLike<TCanvas> {
  id: string;
  ownerId: string;
  title: string;
  canvas: TCanvas;
}

export interface ProjectShareCloneResult<TProject> {
  project: TProject;
  created: boolean;
  historyPending: boolean;
}

export interface ProjectShareRepositoryPort<TProject> {
  getByShareId(shareId: string): Promise<TProject | null>;
  cloneSharedProject(
    ownerId: string,
    shareId: string,
  ): Promise<ProjectShareCloneResult<TProject> | null>;
  markSharedProjectHistoryRecorded(
    ownerId: string,
    projectId: string,
    shareId: string,
  ): Promise<boolean>;
}

export interface ProjectShareHistoryRepositoryPort<TCanvas> {
  ensureCreatedSnapshot(input: {
    ownerId: string;
    projectId: string;
    title: string;
    canvas: TCanvas;
  }): Promise<unknown>;
}

export interface ProjectSharePreview {
  title: string;
}

export interface ProjectShareCloneView {
  projectId: string;
  created: boolean;
}

export interface ProjectShareService {
  getPreview(shareId: string): Promise<ProjectSharePreview | null>;
  cloneForOwner(actorUserId: string, shareId: string): Promise<ProjectShareCloneView | null>;
}

export interface CreateProjectShareServiceOptions<
  TCanvas,
  TProject extends SharedProjectLike<TCanvas>,
> {
  getHistoryRepository: () =>
    | ProjectShareHistoryRepositoryPort<TCanvas>
    | Promise<ProjectShareHistoryRepositoryPort<TCanvas>>;
  getProjectRepository: () =>
    | ProjectShareRepositoryPort<TProject>
    | Promise<ProjectShareRepositoryPort<TProject>>;
  invalidateProject: (actorUserId: string, projectId: string) => Promise<void>;
  trace?: TraceStep;
  tracePrefix: string;
}

const PROJECT_SHARE_ID_PATTERN = /^[0-9a-f]{32}$/;

export function isValidProjectShareId(value: string | null | undefined): value is string {
  return typeof value === 'string' && PROJECT_SHARE_ID_PATTERN.test(value);
}

export function createProjectShareService<TCanvas, TProject extends SharedProjectLike<TCanvas>>(
  options: CreateProjectShareServiceOptions<TCanvas, TProject>,
): ProjectShareService {
  const trace: TraceStep = options.trace ?? (async (_name, _operation, callback) => callback());

  return {
    async getPreview(shareId) {
      if (!isValidProjectShareId(shareId)) return null;
      const repository = await trace(
        `${options.tracePrefix}.shares.preview.repository`,
        'db.connect',
        options.getProjectRepository,
      );
      const project = await trace(
        `${options.tracePrefix}.shares.preview.query`,
        'db.query',
        () => repository.getByShareId(shareId),
        { share_id: shareId },
      );
      if (!project) return null;
      if (!project.id.trim() || !project.ownerId.trim() || !project.title.trim()) {
        throw new Error('Shared project repository returned an invalid project boundary');
      }
      return { title: project.title };
    },

    async cloneForOwner(actorUserId, shareId) {
      assertNonBlank(actorUserId, 'actorUserId');
      if (!isValidProjectShareId(shareId)) return null;
      const repository = await trace(
        `${options.tracePrefix}.shares.clone.repository`,
        'db.connect',
        options.getProjectRepository,
      );
      const result = await trace(
        `${options.tracePrefix}.shares.clone.create`,
        'db.insert',
        () => repository.cloneSharedProject(actorUserId, shareId),
        { share_id: shareId },
      );
      if (!result) return null;
      if (result.project.ownerId !== actorUserId || !result.project.id.trim()) {
        throw new Error('Shared project clone crossed the requested identity boundary');
      }

      await trace(
        `${options.tracePrefix}.shares.clone.cache_invalidate`,
        'cache.delete',
        () => options.invalidateProject(actorUserId, result.project.id),
        { project_id: result.project.id },
      );

      if (result.historyPending) {
        const historyRepository = await trace(
          `${options.tracePrefix}.shares.clone.history_repository`,
          'db.connect',
          options.getHistoryRepository,
        );
        await trace(
          `${options.tracePrefix}.shares.clone.history`,
          'db.insert',
          () =>
            historyRepository.ensureCreatedSnapshot({
              ownerId: actorUserId,
              projectId: result.project.id,
              title: result.project.title,
              canvas: result.project.canvas,
            }),
          { project_id: result.project.id },
        );
        const marked = await trace(
          `${options.tracePrefix}.shares.clone.history_mark`,
          'db.update',
          () =>
            repository.markSharedProjectHistoryRecorded(actorUserId, result.project.id, shareId),
          { project_id: result.project.id },
        );
        if (!marked) {
          throw new Error('Shared project clone history marker crossed the project boundary');
        }
      }

      return { projectId: result.project.id, created: result.created };
    },
  };
}

function assertNonBlank(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}
