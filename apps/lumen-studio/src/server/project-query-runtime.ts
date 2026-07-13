import 'server-only';

import { type ProjectQueryService, createProjectQueryService } from '@lumen/backend';
import { type ProjectListRecord, ProjectListRecordSchema } from '@lumen/db';

import { getProjectRepository, getStudioCache } from './db';
import { traceStudioStep } from './telemetry';

let projectQueries: ProjectQueryService<ProjectListRecord> | null = null;

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
