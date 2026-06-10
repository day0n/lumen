import { randomUUID } from 'node:crypto';

import type { Db, Document, Filter } from 'mongodb';

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

/** Atlas Vector Search 索引名（建在 studio_material_assets.embedding 上）。 */
export const MATERIAL_ASSETS_VECTOR_INDEX = 'material_assets_vector_index';
/** 素材向量维度，必须与入库 / 查询两端使用的 embedding 模型一致。 */
export const MATERIAL_EMBEDDING_DIMS = 1536;
/** 入库 / 查询统一使用的 embedding 模型，改这里要同步重建索引。 */
export const MATERIAL_EMBEDDING_MODEL = 'text-embedding-3-small';

const WORKFLOW_RESULT_MATERIAL_KINDS = ['image', 'video', 'audio'] as const;
type WorkflowResultMaterialKind = (typeof WORKFLOW_RESULT_MATERIAL_KINDS)[number];

export interface WorkflowNodeResultSnapshot {
  nodeId: string;
  runId: string;
  status: string;
  output: string | null;
  error: string | null;
  errorCode?: number;
  errorName?: string;
  errorI18nKey?: string;
  retryable?: boolean;
  attempts?: number;
  progress: number;
  updatedAt: string;
}

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
  error?: string;
  error_code?: number;
  error_name?: string;
  error_i18n_key?: string;
  retryable?: boolean;
  attempts?: number;
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
    await collection.createIndex({ owner_id: 1, source: 1, url: 1 });
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

    await this.ensureVectorSearchIndex();
  }

  /**
   * 在 studio_material_assets.embedding 上建 Atlas Vector Search 索引（幂等）。
   *
   * 设计成「绝不抛错」：本地/社区版 Mongo 没有 search index 能力，或 Atlas 侧
   * 暂时不可用时，只记录日志，不能让整个 ensureIndexes 失败（它在 studio 启动
   * 预热和懒加载路径上被 await，抛错会拖垮素材库相关接口）。
   */
  private async ensureVectorSearchIndex(): Promise<void> {
    const collection = this.collection() as unknown as {
      listSearchIndexes?: () => AsyncIterable<{ name?: string }>;
      createSearchIndex?: (index: Document) => Promise<string>;
    };
    if (!collection.listSearchIndexes || !collection.createSearchIndex) return;

    try {
      for await (const index of collection.listSearchIndexes()) {
        if (index.name === MATERIAL_ASSETS_VECTOR_INDEX) return;
      }
      await collection.createSearchIndex({
        name: MATERIAL_ASSETS_VECTOR_INDEX,
        type: 'vectorSearch',
        definition: {
          fields: [
            {
              type: 'vector',
              path: 'embedding',
              numDimensions: MATERIAL_EMBEDDING_DIMS,
              similarity: 'cosine',
            },
            { type: 'filter', path: 'owner_id' },
            { type: 'filter', path: 'category' },
            { type: 'filter', path: 'kind' },
            { type: 'filter', path: 'source' },
          ],
        },
      });
    } catch {
      // 非致命：索引能力不可用时静默跳过，素材仍可正常入库，只是暂不可向量检索。
    }
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
      // embedding 向量动辄上千个浮点数，列表场景用不到，投影排除以省带宽和解析开销。
      .find(filter, { projection: { embedding: 0 } })
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
      .find(filter, {
        // Project only the fields toWorkflowResultAssetRecord actually reads.
        // Without this we pulled the entire `input` field, which on workflow
        // node results can hold full prompts, base64 image inputs, or
        // composition clip lists. With limit=200 (default) this materialised
        // up to 200 large documents per /api/material-assets call just to
        // surface a thumbnail and a 100-char prompt preview. Restricting to
        // the small set of fields used downstream cuts network IO and the
        // Zod parse cost in toWorkflowResultAssetRecord substantially.
        projection: {
          run_id: 1,
          node_id: 1,
          node_type: 1,
          user_id: 1,
          project_id: 1,
          workflow_id: 1,
          status: 1,
          output_type: 1,
          output_value: 1,
          asset: 1,
          'input.prompt': 1,
          created_at: 1,
          updated_at: 1,
          completed_at: 1,
        },
      })
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
      ...(parsed.embedding?.length ? { embedding: parsed.embedding } : {}),
      ...(parsed.embeddingText ? { embedding_text: parsed.embeddingText } : {}),
      ...(parsed.embeddingModel ? { embedding_model: parsed.embeddingModel } : {}),
      created_at: now,
      updated_at: now,
    };

    await this.collection().insertOne(document);
    return toMaterialAssetRecord(document);
  }

  async findUserUploadByUrl(ownerId: string, url: string): Promise<MaterialAssetRecord | null> {
    const normalizedUrl = normalizedString(url);
    if (!normalizedUrl) return null;

    const document = await this.collection().findOne({
      owner_id: ownerId,
      source: 'user_upload',
      url: normalizedUrl,
    });
    return document ? toMaterialAssetRecord(document) : null;
  }

  async patchUserUploadEmbedding(
    ownerId: string,
    assetId: string,
    patch: {
      embedding: number[];
      embeddingText: string;
      embeddingModel: string;
    },
  ): Promise<boolean> {
    if (patch.embedding.length !== MATERIAL_EMBEDDING_DIMS) return false;

    const result = await this.collection().updateOne(
      {
        _id: assetId,
        owner_id: ownerId,
        source: 'user_upload',
      },
      {
        $set: {
          embedding: patch.embedding,
          embedding_text: patch.embeddingText,
          embedding_model: patch.embeddingModel,
        },
      },
    );
    return result.modifiedCount > 0;
  }

  async getLatestNodeResultsForProject(
    projectId: string,
    nodeIds: string[],
  ): Promise<WorkflowNodeResultSnapshot[]> {
    const ids = [...new Set(nodeIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) return [];

    const documents = await this.workflowResultCollection()
      .aggregate<{ doc: WorkflowNodeResultDocument }>([
        {
          $match: {
            node_id: { $in: ids },
            $or: [{ project_id: projectId }, { workflow_id: projectId }],
          },
        },
        // Project early so the $sort/$group stages move much smaller docs.
        // toWorkflowNodeResultSnapshot only reads these fields; everything
        // else (notably `input`, which can hold full prompts/base64 payload)
        // would otherwise be carried through the pipeline for nothing.
        {
          $project: {
            node_id: 1,
            run_id: 1,
            status: 1,
            output_value: 1,
            asset: 1,
            error: 1,
            error_code: 1,
            error_name: 1,
            error_i18n_key: 1,
            retryable: 1,
            attempts: 1,
            created_at: 1,
            updated_at: 1,
            completed_at: 1,
          },
        },
        { $sort: { updated_at: -1, completed_at: -1, created_at: -1 } },
        {
          $group: {
            _id: '$node_id',
            doc: { $first: '$$ROOT' },
          },
        },
      ])
      .toArray();

    return documents
      .map((entry) => toWorkflowNodeResultSnapshot(entry.doc))
      .filter((entry): entry is WorkflowNodeResultSnapshot => Boolean(entry));
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

function toWorkflowNodeResultSnapshot(
  document: WorkflowNodeResultDocument,
): WorkflowNodeResultSnapshot | null {
  const nodeId = normalizedString(document.node_id);
  const runId = normalizedString(document.run_id);
  if (!nodeId || !runId) return null;

  const status = normalizedString(document.status) ?? 'idle';
  const output =
    normalizedString(document.asset?.url) ?? normalizedString(document.output_value) ?? null;
  const error = normalizedString(document.error) ?? null;
  const updatedAt = (
    document.updated_at ??
    document.completed_at ??
    document.created_at ??
    new Date()
  ).toISOString();

  return {
    nodeId,
    runId,
    status,
    output,
    error,
    ...(typeof document.error_code === 'number' ? { errorCode: document.error_code } : {}),
    ...(normalizedString(document.error_name) ? { errorName: document.error_name } : {}),
    ...(normalizedString(document.error_i18n_key) ? { errorI18nKey: document.error_i18n_key } : {}),
    ...(typeof document.retryable === 'boolean' ? { retryable: document.retryable } : {}),
    ...(typeof document.attempts === 'number' ? { attempts: document.attempts } : {}),
    progress: status === 'success' ? 1 : status === 'running' ? 0.45 : 0,
    updatedAt,
  };
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
