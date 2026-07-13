import type { WorkflowNodeResultSnapshot } from '@lumen/db';

import { requireStudioUser } from './auth';
import { getStudioWorkflowStatusQueries } from './project-query-runtime';
import { traceStudioStep } from './telemetry';

export async function getStudioWorkflowNodeStatus(
  projectId: string,
  nodeIds: string[],
): Promise<WorkflowNodeResultSnapshot[]> {
  const user = await traceStudioStep('studio.auth.require_user', 'auth', () => requireStudioUser());
  const results = await getStudioWorkflowStatusQueries().getNodeResults(
    user.id,
    projectId,
    nodeIds,
  );
  if (!results) throw new Error('project not found');
  return results;
}
