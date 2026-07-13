import 'server-only';

import { reconcileCanvasWithWorkflowResults as reconcileCanvas } from '@lumen/backend';
import type { ProjectCanvas } from '@lumen/db';

import { getWorkflowNodeResultRepository } from './db';

export async function reconcileCanvasWithWorkflowResults(
  projectId: string,
  canvas: ProjectCanvas,
): Promise<ProjectCanvas> {
  return reconcileCanvas(projectId, canvas, async (workflowId, nodeIds) => {
    const repository = await getWorkflowNodeResultRepository();
    return repository.getLatestNodeResultsForProject(workflowId, nodeIds);
  });
}
