import 'server-only';

import { createHomeQueryService } from '@lumen/backend/source/home-query-service';
import { HomeFeaturedItemRecordSchema, HomeWorkflowTemplateListRecordSchema } from '@lumen/db';

import { getHomeFeaturedRepository, getHomeWorkflowTemplateRepository, getStudioCache } from './db';
import { traceStudioStep } from './telemetry';

let homeQueryService: ReturnType<typeof createService> | null = null;

export function getStudioHomeQueryService() {
  homeQueryService ??= createService();
  return homeQueryService;
}

function createService() {
  return createHomeQueryService({
    cache: getStudioCache(),
    featuredListSchema: HomeFeaturedItemRecordSchema.array(),
    templateListSchema: HomeWorkflowTemplateListRecordSchema,
    getFeaturedRepository: getHomeFeaturedRepository,
    getTemplateRepository: getHomeWorkflowTemplateRepository,
    trace: traceStudioStep,
    tracePrefix: 'studio',
  });
}
