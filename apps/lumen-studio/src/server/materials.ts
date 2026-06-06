import 'server-only';

import type {
  CreateUserMaterialAssetInput,
  MaterialAssetCategory,
  MaterialAssetKind,
  MaterialAssetRecord,
} from '@lumen/db';
import { MaterialAssetRecordSchema } from '@lumen/db';

import { requireStudioUser } from './auth';
import { getMaterialAssetRepository, getProjectRepository, getStudioCache } from './db';
import { traceStudioStep } from './telemetry';

const MATERIAL_ASSET_LIST_CACHE_TTL_SECONDS = 60;

export interface ListStudioMaterialAssetsOptions {
  workflowId?: string;
  category?: MaterialAssetCategory;
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
  const cache = getStudioCache();
  const canUseCache = !workflowId;
  const cacheKey = materialAssetListCacheKey(ownerId, {
    workflowId,
    category: options.category,
    kind: options.kind,
    limit,
  });

  const cached = canUseCache
    ? await traceStudioStep(
        'studio.material_assets.list.cache_get',
        'cache.get',
        () => cache.get(cacheKey, MaterialAssetRecordSchema.array()),
        {
          has_category: Boolean(options.category),
          has_kind: Boolean(options.kind),
          limit,
        },
      )
    : null;

  if (cached) return cached;

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
    category: options.category,
    kind: options.kind,
    limit,
  };
  const attributes = {
    has_workflow_id: Boolean(options.workflowId),
    has_category: Boolean(options.category),
    has_kind: Boolean(options.kind),
    limit,
  };

  const [storedAssets, workflowResultAssets] = await Promise.all([
    traceStudioStep(
      'studio.material_assets.list.db',
      'db.query',
      () => listStoredMaterialAssets(repository, query),
      attributes,
    ),
    workflowId && (!options.category || options.category === 'my_assets')
      ? traceStudioStep(
          'studio.material_assets.workflow_results.db',
          'db.query',
          () =>
            repository.listWorkflowResultAssets({
              ownerId,
              workflowId,
              category: 'my_assets',
              kind: options.kind,
              limit,
            }),
          attributes,
        )
      : Promise.resolve([]),
  ]);

  const assets = mergeMaterialAssets(workflowResultAssets, storedAssets, query.limit);

  if (canUseCache) {
    await traceStudioStep(
      'studio.material_assets.list.cache_set',
      'cache.set',
      () => cache.set(cacheKey, assets, MATERIAL_ASSET_LIST_CACHE_TTL_SECONDS),
      { result_count: assets.length, limit },
    );
  }

  return assets;
}

async function listStoredMaterialAssets(
  repository: Awaited<ReturnType<typeof getMaterialAssetRepository>>,
  query: {
    ownerId: string;
    workflowId?: string;
    category?: MaterialAssetCategory;
    kind?: MaterialAssetKind;
    limit: number;
  },
) {
  if (query.category) {
    return repository.list({
      ownerId: query.ownerId,
      workflowId: query.category === 'my_assets' ? query.workflowId : undefined,
      category: query.category,
      kind: query.kind,
      limit: query.limit,
    });
  }

  if (!query.workflowId) {
    const libraryCategories: MaterialAssetCategory[] = ['item', 'character', 'scene'];
    const groups = await Promise.all(
      libraryCategories.map((category) =>
        repository.list({
          ownerId: query.ownerId,
          category,
          kind: query.kind,
          limit: query.limit,
        }),
      ),
    );
    return groups.flat();
  }

  const libraryCategories: MaterialAssetCategory[] = ['item', 'character', 'scene'];
  const groups = await Promise.all([
    repository.list({
      ownerId: query.ownerId,
      workflowId: query.workflowId,
      category: 'my_assets',
      kind: query.kind,
      limit: query.limit,
    }),
    ...libraryCategories.map((category) =>
      repository.list({
        ownerId: query.ownerId,
        category,
        kind: query.kind,
        limit: query.limit,
      }),
    ),
  ]);
  return groups.flat();
}

export async function createStudioMaterialAsset(
  input: Omit<CreateUserMaterialAssetInput, 'ownerId'>,
): Promise<MaterialAssetRecord> {
  const user = await traceStudioStep('studio.auth.require_user', 'auth', () => requireStudioUser());
  return createStudioMaterialAssetForOwner(user.id, input);
}

export async function createStudioMaterialAssetForOwner(
  ownerId: string,
  input: Omit<CreateUserMaterialAssetInput, 'ownerId'>,
): Promise<MaterialAssetRecord> {
  const repository = await traceStudioStep('studio.material_assets.repository', 'db.connect', () =>
    getMaterialAssetRepository(),
  );

  const asset = await traceStudioStep(
    'studio.material_assets.create_user_upload.db',
    'db.query',
    () => repository.createUserUpload({ ...input, ownerId }),
    {
      category: input.category,
      kind: input.kind,
    },
  );

  await invalidateMaterialAssetListCache(ownerId);
  return asset;
}

export async function deleteStudioMaterialAsset(assetId: string): Promise<boolean> {
  const user = await traceStudioStep('studio.auth.require_user', 'auth', () => requireStudioUser());
  const repository = await traceStudioStep('studio.material_assets.repository', 'db.connect', () =>
    getMaterialAssetRepository(),
  );

  const deleted = await traceStudioStep(
    'studio.material_assets.delete_user_upload.db',
    'db.query',
    () => repository.deleteUserUpload(user.id, assetId),
    { asset_id: assetId },
  );

  if (deleted) await invalidateMaterialAssetListCache(user.id);
  return deleted;
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

function materialAssetListCacheKey(
  ownerId: string,
  query: {
    workflowId?: string;
    category?: MaterialAssetCategory;
    kind?: MaterialAssetKind;
    limit: number;
  },
) {
  return [
    'materials',
    ownerId,
    'list',
    'v1',
    query.workflowId ?? 'all-workflows',
    query.category ?? 'all-categories',
    query.kind ?? 'all-kinds',
    query.limit,
  ].join(':');
}

async function invalidateMaterialAssetListCache(ownerId: string) {
  await getStudioCache().deletePattern(`materials:${ownerId}:list:v1:*`, 'lumen:studio:');
}
