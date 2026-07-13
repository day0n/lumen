import 'server-only';

import {
  type ProjectDetailQueryService,
  type ProjectQueryService,
  type WorkflowStatusQueryService,
  createProjectDetailQueryService,
  createProjectQueryService,
  createWorkflowStatusQueryService,
} from '@lumen/backend';
import {
  type ProjectCanvas,
  type ProjectListRecord,
  ProjectListRecordSchema,
  type ProjectRecord,
  ProjectRecordSchema,
} from '@lumen/db';

import { getProjectRepository, getStudioCache, getWorkflowNodeResultRepository } from './db';
import { traceStudioStep } from './telemetry';

let projectQueries: ProjectQueryService<ProjectListRecord> | null = null;
let projectDetailQueries: ProjectDetailQueryService<ProjectRecord> | null = null;
let workflowStatusQueries: WorkflowStatusQueryService | null = null;

export function getStudioProjectQueries(): ProjectQueryService<ProjectListRecord> {
  projectQueries ??= createProjectQueryService({
    cache: getStudioCache(),
    getRepository: getProjectRepository,
    projectListSchema: ProjectListRecordSchema.array(),
    trace: traceStudioStep,
    tracePrefix: 'studio',
  });
  return projectQueries;
}

export function getStudioProjectDetailQueries(): ProjectDetailQueryService<ProjectRecord> {
  projectDetailQueries ??= createProjectDetailQueryService<ProjectCanvas, ProjectRecord>({
    cache: getStudioCache(),
    getProjectRepository,
    getWorkflowNodeResultRepository,
    projectDetailSchema: ProjectRecordSchema,
    trace: traceStudioStep,
    tracePrefix: 'studio',
  });
  return projectDetailQueries;
}

export function getStudioWorkflowStatusQueries(): WorkflowStatusQueryService {
  workflowStatusQueries ??= createWorkflowStatusQueryService({
    getProjectRepository,
    getWorkflowNodeResultRepository,
    trace: traceStudioStep,
    tracePrefix: 'studio',
  });
  return workflowStatusQueries;
}
