import 'server-only';

import type { MaterialAssetKind, MaterialAssetRecord } from '@lumen/db';

import { requireStudioUser } from './auth';
import { getMaterialAssetRepository, getProjectRepository } from './db';
import { traceStudioStep } from './telemetry';

export interface ListStudioMaterialAssetsOptions {
  workflowId?: string;
  kind?: MaterialAssetKind;
  limit?: number;
}

export async function listStudioMaterialAssets(
  options: ListStudioMaterialAssetsOptions = {},
): Promise<MaterialAssetRecord[]> {
  const user = await traceStudioStep('studio.auth.require_user', 'auth', () => requireStudioUser());
  const repository = await traceStudioStep('studio.material_assets.repository', 'db.connect', () =>
    getMaterialAssetRepository(),
  );
  const ownerId = user.id;
  const limit = options.limit ?? 200;
  const workflowId = options.workflowId;

  if (workflowId) {
    const projectRepository = await getProjectRepository();
    const exists = await traceStudioStep(
      'studio.material_assets.project_exists.db',
      'db.query',
      () => projectRepository.exists(user.id, workflowId),
      { workflow_id: workflowId },
    );
    if (!exists) return [];
  }

  const query = {
    ownerId,
    workflowId,
    kind: options.kind,
    limit,
  };
  const attributes = {
    has_workflow_id: Boolean(options.workflowId),
    has_kind: Boolean(options.kind),
    limit,
  };

  const storedAssetsPromise = traceStudioStep(
    'studio.material_assets.list.db',
    'db.query',
    () => repository.list(query),
    attributes,
  );
  const workflowResultAssetsPromise = workflowId
    ? traceStudioStep(
        'studio.material_assets.workflow_results.db',
        'db.query',
        () => repository.listWorkflowResultAssets(query),
        attributes,
      )
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
