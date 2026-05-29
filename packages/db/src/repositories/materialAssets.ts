import type { Db, Filter } from 'mongodb';

import {
  type ListMaterialAssetsInput,
  ListMaterialAssetsInputSchema,
  type MaterialAssetDocument,
  MaterialAssetDocumentSchema,
  type MaterialAssetRecord,
  MaterialAssetRecordSchema,
  type UpsertWorkflowMaterialAssetInput,
  UpsertWorkflowMaterialAssetInputSchema,
} from '../schema/materialAsset';

export const MATERIAL_ASSETS_COLLECTION = 'studio_material_assets';

export class MaterialAssetRepository {
  constructor(private readonly db: Db) {}

  async ensureIndexes(): Promise<void> {
    const collection = this.collection();
    await collection.createIndex({ owner_id: 1, category: 1, kind: 1, updated_at: -1 });
    await collection.createIndex({ owner_id: 1, workflow_id: 1, kind: 1, updated_at: -1 });
    await collection.createIndex({ workflow_id: 1, run_id: 1, node_id: 1 });
  }

  async list(input: ListMaterialAssetsInput): Promise<MaterialAssetRecord[]> {
    const parsed = ListMaterialAssetsInputSchema.parse(input);
    const filter: Filter<MaterialAssetDocument> = {
      owner_id: parsed.ownerId,
    };

    if (parsed.workflowId) filter.workflow_id = parsed.workflowId;
    if (parsed.category) filter.category = parsed.category;
    if (parsed.kind) filter.kind = parsed.kind;

    const documents = await this.collection()
      .find(filter)
      .sort({ updated_at: -1 })
      .limit(parsed.limit)
      .toArray();

    return documents.map(toMaterialAssetRecord);
  }

  async upsertWorkflowResult(
    input: UpsertWorkflowMaterialAssetInput,
  ): Promise<MaterialAssetRecord> {
    const parsed = UpsertWorkflowMaterialAssetInputSchema.parse(input);
    const now = new Date();
    const id = workflowAssetId(parsed.ownerId, parsed.workflowId, parsed.runId, parsed.nodeId);
    const document = await this.collection().findOneAndUpdate(
      { _id: id },
      {
        $set: {
          owner_id: parsed.ownerId,
          workflow_id: parsed.workflowId,
          run_id: parsed.runId,
          node_id: parsed.nodeId,
          node_type: parsed.nodeType,
          category: 'my_assets',
          kind: parsed.kind,
          source: 'workflow_result',
          title: parsed.title,
          url: parsed.url,
          ...(parsed.thumbnailUrl ? { thumbnail_url: parsed.thumbnailUrl } : {}),
          ...(parsed.r2Key ? { r2_key: parsed.r2Key } : {}),
          ...(parsed.contentType ? { content_type: parsed.contentType } : {}),
          ...(parsed.size !== undefined ? { size: parsed.size } : {}),
          ...(parsed.inputPrompt ? { input_prompt: parsed.inputPrompt } : {}),
          updated_at: now,
        },
        $setOnInsert: {
          _id: id,
          created_at: now,
        },
        $unset: {
          ...(parsed.thumbnailUrl ? {} : { thumbnail_url: '' }),
          ...(parsed.r2Key ? {} : { r2_key: '' }),
          ...(parsed.contentType ? {} : { content_type: '' }),
          ...(parsed.size !== undefined ? {} : { size: '' }),
          ...(parsed.inputPrompt ? {} : { input_prompt: '' }),
        },
      },
      { upsert: true, returnDocument: 'after' },
    );

    if (!document) throw new Error('Failed to upsert workflow material asset');
    return toMaterialAssetRecord(document);
  }

  private collection() {
    return this.db.collection<MaterialAssetDocument>(MATERIAL_ASSETS_COLLECTION);
  }
}

function toMaterialAssetRecord(document: MaterialAssetDocument): MaterialAssetRecord {
  const parsed = MaterialAssetDocumentSchema.parse(document);
  return MaterialAssetRecordSchema.parse({
    id: parsed._id,
    ownerId: parsed.owner_id,
    workflowId: parsed.workflow_id,
    runId: parsed.run_id,
    nodeId: parsed.node_id,
    nodeType: parsed.node_type,
    category: parsed.category,
    kind: parsed.kind,
    source: parsed.source,
    title: parsed.title,
    url: parsed.url,
    thumbnailUrl: parsed.thumbnail_url,
    r2Key: parsed.r2_key,
    contentType: parsed.content_type,
    size: parsed.size,
    inputPrompt: parsed.input_prompt,
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
  });
}

function workflowAssetId(ownerId: string, workflowId: string, runId: string, nodeId: string) {
  return `${ownerId}:${workflowId}:${runId}:${nodeId}`;
}
