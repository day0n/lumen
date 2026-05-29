import 'server-only';

import type { MaterialAssetKind, MaterialAssetRecord } from '@lumen/db';

import { requireStudioUser } from './auth';
import { getMaterialAssetRepository, getProjectRepository } from './db';

export interface ListStudioMaterialAssetsOptions {
  workflowId?: string;
  kind?: MaterialAssetKind;
  limit?: number;
}

export async function listStudioMaterialAssets(
  options: ListStudioMaterialAssetsOptions = {},
): Promise<MaterialAssetRecord[]> {
  const user = await requireStudioUser();
  const repository = await getMaterialAssetRepository();
  let ownerId = user.id;

  if (options.workflowId) {
    const projectRepository = await getProjectRepository();
    const project = await projectRepository.get(user.id, options.workflowId);
    if (!project) return [];
    ownerId = project.ownerId;
  }

  return repository.list({
    ownerId,
    workflowId: options.workflowId,
    kind: options.kind,
    limit: options.limit ?? 200,
  });
}
