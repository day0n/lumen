import type { TraceStep } from './home-query-service.js';
import type {
  WorkflowNodeResultRepositoryPort,
  WorkflowNodeResultSnapshot,
} from './project-detail-query-service.js';

export interface WorkflowStatusProjectRepositoryPort {
  exists(ownerId: string, projectId: string): Promise<boolean>;
}

export interface WorkflowStatusQueryService {
  getNodeResults(
    actorUserId: string,
    projectId: string,
    nodeIds: readonly string[],
  ): Promise<WorkflowNodeResultSnapshot[] | null>;
}

export interface CreateWorkflowStatusQueryServiceOptions {
  getProjectRepository: () =>
    | WorkflowStatusProjectRepositoryPort
    | Promise<WorkflowStatusProjectRepositoryPort>;
  getWorkflowNodeResultRepository: () =>
    | WorkflowNodeResultRepositoryPort
    | Promise<WorkflowNodeResultRepositoryPort>;
  trace?: TraceStep;
  tracePrefix: string;
}

export function createWorkflowStatusQueryService(
  options: CreateWorkflowStatusQueryServiceOptions,
): WorkflowStatusQueryService {
  const trace: TraceStep = options.trace ?? (async (_name, _operation, callback) => callback());

  return {
    async getNodeResults(actorUserId, projectId, nodeIds) {
      assertNonBlank(actorUserId, 'actorUserId');
      assertNonBlank(projectId, 'projectId');

      const projectRepository = await trace(
        `${options.tracePrefix}.projects.workflow_status.project_repository`,
        'db.connect',
        options.getProjectRepository,
      );
      const exists = await trace(
        `${options.tracePrefix}.projects.workflow_status.project_exists`,
        'db.query',
        () => projectRepository.exists(actorUserId, projectId),
        { project_id: projectId },
      );
      if (!exists) return null;

      const uniqueNodeIds = [...new Set(nodeIds.map((nodeId) => nodeId.trim()).filter(Boolean))];
      if (uniqueNodeIds.length === 0) return [];

      const workflowRepository = await trace(
        `${options.tracePrefix}.projects.workflow_status.workflow_repository`,
        'db.connect',
        options.getWorkflowNodeResultRepository,
      );
      return trace(
        `${options.tracePrefix}.projects.workflow_status.workflow_results`,
        'db.query',
        () => workflowRepository.getLatestNodeResultsForProject(projectId, uniqueNodeIds),
        { node_count: uniqueNodeIds.length, project_id: projectId },
      );
    },
  };
}

function assertNonBlank(value: string, name: string): void {
  if (!value.trim()) throw new Error(`${name} is required`);
}
