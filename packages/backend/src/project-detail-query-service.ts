import { projectDetailCacheKey } from '@lumen/shared/project-cache';

import type { JsonCachePort, ParseSchema, TraceStep } from './home-query-service.js';

type CanvasNodeData = Record<string, unknown>;

export interface ProjectCanvasNodeLike {
  id: string;
  data: CanvasNodeData;
}

export interface ProjectCanvasLike {
  nodes: ProjectCanvasNodeLike[];
}

export interface ProjectDetailLike<TCanvas extends ProjectCanvasLike = ProjectCanvasLike> {
  id: string;
  ownerId: string;
  canvas: TCanvas;
}

export interface WorkflowNodeResultSnapshot {
  nodeId: string;
  runId: string;
  status: string;
  output: string | null;
  error: string | null;
  errorCode?: number;
  errorName?: string;
  errorI18nKey?: string;
  retryable?: boolean;
  attempts?: number;
  progress: number;
  updatedAt: string;
}

export interface ProjectDetailRepositoryPort<TProject> {
  get(ownerId: string, projectId: string): Promise<TProject | null>;
}

export interface WorkflowNodeResultRepositoryPort {
  getLatestNodeResultsForProject(
    projectId: string,
    nodeIds: string[],
  ): Promise<WorkflowNodeResultSnapshot[]>;
}

export interface ProjectDetailQueryOptions {
  bypassCache?: boolean;
}

export interface ProjectDetailQueryService<TProject> {
  getProject(
    actorUserId: string,
    projectId: string,
    options?: ProjectDetailQueryOptions,
  ): Promise<TProject | null>;
}

export interface CreateProjectDetailQueryServiceOptions<
  TCanvas extends ProjectCanvasLike,
  TProject extends ProjectDetailLike<TCanvas>,
> {
  cache: JsonCachePort;
  getProjectRepository: () =>
    | ProjectDetailRepositoryPort<TProject>
    | Promise<ProjectDetailRepositoryPort<TProject>>;
  getWorkflowNodeResultRepository: () =>
    | WorkflowNodeResultRepositoryPort
    | Promise<WorkflowNodeResultRepositoryPort>;
  projectDetailSchema: ParseSchema<TProject>;
  trace?: TraceStep;
  tracePrefix: string;
}

export type LoadLatestWorkflowNodeResults = (
  projectId: string,
  nodeIds: string[],
) => Promise<WorkflowNodeResultSnapshot[]>;

const PROJECT_DETAIL_CACHE_TTL_SECONDS = 30;
const BUSY_STATUSES = new Set(['queued', 'running']);
const PUBLIC_ERROR_FIELD_KEYS = [
  'errorCode',
  'errorName',
  'errorI18nKey',
  'retryable',
  'attempts',
] as const;

export function createProjectDetailQueryService<
  TCanvas extends ProjectCanvasLike,
  TProject extends ProjectDetailLike<TCanvas>,
>(
  options: CreateProjectDetailQueryServiceOptions<TCanvas, TProject>,
): ProjectDetailQueryService<TProject> {
  const trace: TraceStep = options.trace ?? (async (_name, _operation, callback) => callback());

  async function reconcileProject(project: TProject): Promise<TProject> {
    const canvas = await reconcileCanvasWithWorkflowResults(
      project.id,
      project.canvas,
      async (projectId, nodeIds) => {
        const repository = await trace(
          `${options.tracePrefix}.projects.detail.workflow_repository`,
          'db.connect',
          options.getWorkflowNodeResultRepository,
        );
        return trace(
          `${options.tracePrefix}.projects.detail.workflow_results`,
          'db.query',
          () => repository.getLatestNodeResultsForProject(projectId, nodeIds),
          { project_id: projectId, node_count: nodeIds.length },
        );
      },
    );
    if (canvas === project.canvas) return project;
    return options.projectDetailSchema.parse({ ...project, canvas });
  }

  return {
    async getProject(actorUserId, projectId, queryOptions = {}) {
      assertNonBlank(actorUserId, 'actorUserId');
      assertNonBlank(projectId, 'projectId');

      const cacheKey = projectDetailCacheKey(actorUserId, projectId);
      const cached = queryOptions.bypassCache
        ? null
        : await trace(
            `${options.tracePrefix}.projects.detail.cache_get`,
            'cache.get',
            () => options.cache.get(cacheKey, options.projectDetailSchema),
            { project_id: projectId },
          );
      if (cached && cached.id === projectId && cached.ownerId === actorUserId) {
        return reconcileProject(cached);
      }
      if (cached) {
        await trace(
          `${options.tracePrefix}.projects.detail.cache_delete_mismatched`,
          'cache.delete',
          () => options.cache.delete(cacheKey),
          { project_id: projectId },
        );
      }

      const repository = await trace(
        `${options.tracePrefix}.projects.detail.repository`,
        'db.connect',
        options.getProjectRepository,
      );
      const project = await trace(
        `${options.tracePrefix}.projects.detail.db`,
        'db.query',
        () => repository.get(actorUserId, projectId),
        { project_id: projectId },
      );
      if (!project) {
        if (queryOptions.bypassCache) {
          await trace(
            `${options.tracePrefix}.projects.detail.cache_delete_missing`,
            'cache.delete',
            () => options.cache.delete(cacheKey),
            { project_id: projectId },
          );
        }
        return null;
      }
      if (project.id !== projectId || project.ownerId !== actorUserId) {
        throw new Error('Project repository crossed the requested identity boundary');
      }

      const reconciled = await reconcileProject(project);
      await trace(
        `${options.tracePrefix}.projects.detail.cache_set`,
        'cache.set',
        () => options.cache.set(cacheKey, reconciled, PROJECT_DETAIL_CACHE_TTL_SECONDS),
        { project_id: projectId },
      );
      return reconciled;
    },
  };
}

export async function reconcileCanvasWithWorkflowResults<TCanvas extends ProjectCanvasLike>(
  projectId: string,
  canvas: TCanvas,
  loadLatestResults: LoadLatestWorkflowNodeResults,
): Promise<TCanvas> {
  const nodeIds = [
    ...new Set(
      canvas.nodes
        .filter((node) => shouldReconcileNode(readStatus(node.data), readOutput(node.data)))
        .map((node) => node.id),
    ),
  ];
  if (nodeIds.length === 0) return canvas;

  const results = await loadLatestResults(projectId, nodeIds);
  if (results.length === 0) return canvas;

  const resultByNodeId = new Map(results.map((result) => [result.nodeId, result]));
  let changed = false;
  const nodes = canvas.nodes.map((node) => {
    const result = resultByNodeId.get(node.id);
    if (!result) return node;

    const data = applyTerminalWorkflowResult(node.data, result);
    if (data === node.data) return node;

    changed = true;
    return { ...node, data };
  });

  return changed ? ({ ...canvas, nodes } as TCanvas) : canvas;
}

function shouldReconcileNode(status: string | undefined, output: string | null) {
  if (BUSY_STATUSES.has(status ?? 'idle')) return true;
  return status === 'success' && !output?.trim();
}

function applyTerminalWorkflowResult(
  current: CanvasNodeData,
  result: WorkflowNodeResultSnapshot,
): CanvasNodeData {
  switch (result.status) {
    case 'success':
      if (!result.output?.trim()) return current;
      return {
        ...withoutPublicErrorFields(current),
        status: 'success',
        output: result.output,
        error: null,
        activeRunId: null,
        progress: 1,
      };
    case 'error':
    case 'failed':
    case 'skipped':
      return {
        ...current,
        status: 'error',
        output: null,
        error: result.error ?? 'Workflow node failed',
        activeRunId: null,
        ...publicErrorFields(result),
        progress: 1,
      };
    case 'cancelled':
      return {
        ...current,
        status: 'cancelled',
        error: result.error ?? 'cancelled',
        activeRunId: null,
        ...publicErrorFields(result),
        progress: 0,
      };
    default:
      return current;
  }
}

function readStatus(data: CanvasNodeData): string | undefined {
  return typeof data.status === 'string' ? data.status : undefined;
}

function readOutput(data: CanvasNodeData): string | null {
  return typeof data.output === 'string' ? data.output : null;
}

function withoutPublicErrorFields(data: CanvasNodeData): CanvasNodeData {
  const omitted = new Set<string>(PUBLIC_ERROR_FIELD_KEYS);
  return Object.fromEntries(Object.entries(data).filter(([key]) => !omitted.has(key)));
}

function publicErrorFields(result: WorkflowNodeResultSnapshot): CanvasNodeData {
  return {
    ...(result.errorCode !== undefined ? { errorCode: result.errorCode } : {}),
    ...(result.errorName ? { errorName: result.errorName } : {}),
    ...(result.errorI18nKey ? { errorI18nKey: result.errorI18nKey } : {}),
    ...(result.retryable !== undefined ? { retryable: result.retryable } : {}),
    ...(result.attempts !== undefined ? { attempts: result.attempts } : {}),
  };
}

function assertNonBlank(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}
