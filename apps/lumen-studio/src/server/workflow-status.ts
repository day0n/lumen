import type { WorkflowNodeResultSnapshot } from '@lumen/db';

import { getMaterialAssetRepository } from './db';
import { getStudioProject } from './projects';

export async function getStudioWorkflowNodeStatus(
  projectId: string,
  nodeIds: string[],
): Promise<WorkflowNodeResultSnapshot[]> {
  const project = await getStudioProject(projectId);
  if (!project) {
    throw new Error('project not found');
  }

  const repository = await getMaterialAssetRepository();
  return repository.getLatestNodeResultsForProject(projectId, nodeIds);
}
