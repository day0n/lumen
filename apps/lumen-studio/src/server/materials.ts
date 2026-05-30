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
  const ownerId = user.id;

  if (options.workflowId) {
    const projectRepository = await getProjectRepository();
    const exists = await projectRepository.exists(user.id, options.workflowId);
    if (!exists) return [];
  }

  const query = {
    ownerId,
    workflowId: options.workflowId,
    kind: options.kind,
    limit: options.limit ?? 200,
  };

  const storedAssetsPromise = repository.list(query);
  const workflowResultAssetsPromise = options.workflowId
    ? repository.listWorkflowResultAssets(query)
    : Promise.resolve([]);
  const [storedAssets, workflowResultAssets] = await Promise.all([
    storedAssetsPromise,
    workflowResultAssetsPromise,
  ]);

  return mergeMaterialAssets(workflowResultAssets, storedAssets, query.limit);
}

function mergeMaterialAssets(
  primary: MaterialAssetRecord[],
  fallback: MaterialAssetRecord[],
  limit: number,
): MaterialAssetRecord[] {
  const merged = new Map<string, MaterialAssetRecord>();

  for (const asset of [...primary, ...fallback]) {
    const key = materialAssetDedupeKey(asset);
    if (!merged.has(key)) merged.set(key, asset);
  }

  return Array.from(merged.values())
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, limit);
}

function materialAssetDedupeKey(asset: MaterialAssetRecord) {
  if (asset.source === 'workflow_result' && asset.runId && asset.nodeId) {
    return `workflow-result:${asset.runId}:${asset.nodeId}`;
  }

  return `asset:${asset.id}`;
}
