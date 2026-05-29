import 'server-only';

import type { MaterialAssetKind, MaterialAssetRecord } from '@lumen/db';

import { requireStudioUser } from './auth';
import { getMaterialAssetRepository } from './db';

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

  return repository.list({
    ownerId: user.id,
    workflowId: options.workflowId,
    kind: options.kind,
    limit: options.limit ?? 200,
  });
}
