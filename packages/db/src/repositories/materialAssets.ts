import { randomUUID } from 'node:crypto';

import type { Db, Filter } from 'mongodb';

import {
  type CreateUserMaterialAssetInput,
  CreateUserMaterialAssetInputSchema,
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
export const WORKFLOW_NODE_RESULTS_COLLECTION = 'workflow_node_results';

const WORKFLOW_RESULT_MATERIAL_KINDS = ['image', 'video', 'audio'] as const;
type WorkflowResultMaterialKind = (typeof WORKFLOW_RESULT_MATERIAL_KINDS)[number];

interface WorkflowNodeResultDocument {
  _id: string;
  run_id: string;
  project_id?: string | null;
  workflow_id?: string | null;
  user_id?: string | null;
  node_id: string;
  node_type?: string;
  status: string;
  input?: Record<string, unknown>;
  output_type?: string;
  output_value?: string;
  asset?: {
    key?: string;
    url?: string;
    content_type?: string;
    size?: number;
    uploaded_at?: Date;
  };
  created_at?: Date;
  updated_at?: Date;
  completed_at?: Date;
}

export class MaterialAssetRepository {
  constructor(private readonly db: Db) {}

  async ensureIndexes(): Promise<void> {
    const collection = this.collection();
    await collection.createIndex({ owner_id: 1, category: 1, kind: 1, updated_at: -1 });
    await collection.createIndex({ owner_id: 1, workflow_id: 1, kind: 1, updated_at: -1 });
    await collection.createIndex({ owner_id: 1, workflow_id: 1, updated_at: -1 });
    await collection.createIndex({ workflow_id: 1, run_id: 1, node_id: 1 });

    const workflowResults = this.workflowResultCollection();
    await workflowResults.createIndex({
      project_id: 1,
      status: 1,
      output_type: 1,
      completed_at: -1,
    });
    await workflowResults.createIndex({
      workflow_id: 1,
      status: 1,
      output_type: 1,
      completed_at: -1,
    });
    await workflowResults.createIndex({
      user_id: 1,
      project_id: 1,
      status: 1,
      output_type: 1,
      completed_at: -1,
    });
    await workflowResults.createIndex({
      user_id: 1,
      workflow_id: 1,
      status: 1,
      output_type: 1,
      completed_at: -1,
    });
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

  async listWorkflowResultAssets(input: ListMaterialAssetsInput): Promise<MaterialAssetRecord[]> {
    const parsed = ListMaterialAssetsInputSchema.parse(input);
    if (!parsed.workflowId) return [];
    if (parsed.category && parsed.category !== 'my_assets') return [];
    const workflowId = parsed.workflowId;

    const outputTypes = parsed.kind ? [parsed.kind] : [...WORKFLOW_RESULT_MATERIAL_KINDS];
    const filter: Filter<WorkflowNodeResultDocument> = {
      status: 'success',
      output_type: { $in: outputTypes },
      output_value: { $ne: '' },
      $and: [
        { $or: [{ project_id: workflowId }, { workflow_id: workflowId }] },
        {
          $or: [{ user_id: parsed.ownerId }, { user_id: null }, { user_id: { $exists: false } }],
        },
      ],
    };

    const documents = await this.workflowResultCollection()
      .find(filter)
      .sort({ completed_at: -1, updated_at: -1, created_at: -1 })
      .limit(parsed.limit)
      .toArray();

    return documents
      .map((document) => toWorkflowResultAssetRecord(document, parsed.ownerId, workflowId))
      .filter((record): record is MaterialAssetRecord => Boolean(record));
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

  async createUserUpload(input: CreateUserMaterialAssetInput): Promise<MaterialAssetRecord> {
    const parsed = CreateUserMaterialAssetInputSchema.parse(input);
    const now = new Date();
    const document: MaterialAssetDocument = {
      _id: `asset_${randomUUID()}`,
      owner_id: parsed.ownerId,
      category: parsed.category,
      kind: parsed.kind,
      source: 'user_upload',
      title: parsed.title,
      url: parsed.url,
      ...(parsed.thumbnailUrl ? { thumbnail_url: parsed.thumbnailUrl } : {}),
      ...(parsed.r2Key ? { r2_key: parsed.r2Key } : {}),
      ...(parsed.contentType ? { content_type: parsed.contentType } : {}),
      ...(parsed.size !== undefined ? { size: parsed.size } : {}),
      ...(parsed.inputPrompt ? { input_prompt: parsed.inputPrompt } : {}),
      ...(parsed.metadata ? { metadata: toDocumentMetadata(parsed.metadata) } : {}),
      created_at: now,
      updated_at: now,
    };

    await this.collection().insertOne(document);
    return toMaterialAssetRecord(document);
  }

  async deleteUserUpload(ownerId: string, assetId: string): Promise<boolean> {
    const result = await this.collection().deleteOne({
      _id: assetId,
      owner_id: ownerId,
      source: 'user_upload',
    });
    return result.deletedCount > 0;
  }

  private collection() {
    return this.db.collection<MaterialAssetDocument>(MATERIAL_ASSETS_COLLECTION);
  }

  private workflowResultCollection() {
    return this.db.collection<WorkflowNodeResultDocument>(WORKFLOW_NODE_RESULTS_COLLECTION);
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
    metadata: parsed.metadata ? toRecordMetadata(parsed.metadata) : undefined,
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
  });
}

function workflowAssetId(ownerId: string, workflowId: string, runId: string, nodeId: string) {
  return `${ownerId}:${workflowId}:${runId}:${nodeId}`;
}

function toWorkflowResultAssetRecord(
  document: WorkflowNodeResultDocument,
  ownerId: string,
  workflowId: string,
): MaterialAssetRecord | null {
  const kind = toWorkflowResultMaterialKind(document.output_type);
  const url = normalizedString(document.asset?.url) ?? normalizedString(document.output_value);
  if (!kind || !url) return null;

  const updatedAt =
    document.completed_at ?? document.updated_at ?? document.created_at ?? new Date();
  const createdAt = document.created_at ?? updatedAt;
  const inputPrompt = truncateMaterialPrompt(document.input?.prompt);

  return MaterialAssetRecordSchema.parse({
    id: `workflow-result:${document.run_id}:${document.node_id}`,
    ownerId: normalizedString(document.user_id) ?? ownerId,
    workflowId:
      normalizedString(document.workflow_id) ?? normalizedString(document.project_id) ?? workflowId,
    runId: document.run_id,
    nodeId: document.node_id,
    ...(normalizedString(document.node_type)
      ? { nodeType: normalizedString(document.node_type) }
      : {}),
    category: 'my_assets',
    kind,
    source: 'workflow_result',
    title: workflowResultTitle(kind, document.node_id, inputPrompt),
    url,
    ...(kind === 'image' ? { thumbnailUrl: url } : {}),
    ...(normalizedString(document.asset?.key)
      ? { r2Key: normalizedString(document.asset?.key) }
      : {}),
    ...(normalizedString(document.asset?.content_type)
      ? { contentType: normalizedString(document.asset?.content_type) }
      : {}),
    ...(typeof document.asset?.size === 'number' ? { size: document.asset.size } : {}),
    ...(inputPrompt ? { inputPrompt } : {}),
    createdAt: createdAt.toISOString(),
    updatedAt: updatedAt.toISOString(),
  });
}

function toWorkflowResultMaterialKind(value: unknown): WorkflowResultMaterialKind | null {
  return WORKFLOW_RESULT_MATERIAL_KINDS.find((kind) => kind === value) ?? null;
}

function workflowResultTitle(
  kind: WorkflowResultMaterialKind,
  nodeId: string,
  inputPrompt?: string,
) {
  if (inputPrompt) return inputPrompt.slice(0, 80);

  switch (kind) {
    case 'image':
      return `图片结果 · ${nodeId}`;
    case 'video':
      return `视频结果 · ${nodeId}`;
    case 'audio':
      return `音乐结果 · ${nodeId}`;
  }
}

function normalizedString(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function truncateMaterialPrompt(value: unknown): string | undefined {
  const normalized = normalizedString(value);
  return normalized ? normalized.slice(0, 100) : undefined;
}

function toDocumentMetadata(metadata: CreateUserMaterialAssetInput['metadata']) {
  if (!metadata) return undefined;
  return {
    ...(metadata.subcategory ? { subcategory: metadata.subcategory } : {}),
    ...(metadata.originalName ? { original_name: metadata.originalName } : {}),
    ...(metadata.sellingPoints?.length ? { selling_points: metadata.sellingPoints } : {}),
    ...(metadata.batchId ? { batch_id: metadata.batchId } : {}),
    ...(metadata.position !== undefined ? { position: metadata.position } : {}),
  };
}

function toRecordMetadata(metadata: MaterialAssetDocument['metadata']) {
  if (!metadata) return undefined;
  return {
    ...(metadata.subcategory ? { subcategory: metadata.subcategory } : {}),
    ...(metadata.original_name ? { originalName: metadata.original_name } : {}),
    ...(metadata.selling_points?.length ? { sellingPoints: metadata.selling_points } : {}),
    ...(metadata.batch_id ? { batchId: metadata.batch_id } : {}),
    ...(metadata.position !== undefined ? { position: metadata.position } : {}),
  };
}
