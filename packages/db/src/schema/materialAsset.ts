import { z } from 'zod';

const MaterialInputPromptSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  return value.trim().slice(0, 100);
}, z.string().max(100));

export const MaterialAssetKindSchema = z.enum(['image', 'video', 'audio']);
export type MaterialAssetKind = z.infer<typeof MaterialAssetKindSchema>;

export const MaterialAssetCategorySchema = z.enum(['my_assets', 'character', 'scene', 'item']);
export type MaterialAssetCategory = z.infer<typeof MaterialAssetCategorySchema>;

export const UserUploadMaterialAssetCategorySchema = z.enum(['character', 'scene', 'item']);
export type UserUploadMaterialAssetCategory = z.infer<typeof UserUploadMaterialAssetCategorySchema>;

export const MaterialAssetSourceSchema = z.enum(['workflow_result', 'user_upload', 'manual']);
export type MaterialAssetSource = z.infer<typeof MaterialAssetSourceSchema>;

const MaterialAssetMetadataDocumentSchema = z
  .object({
    subcategory: z.string().trim().min(1).max(80).optional(),
    original_name: z.string().trim().min(1).max(180).optional(),
    selling_points: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
    batch_id: z.string().trim().min(1).max(80).optional(),
    position: z.number().int().min(0).max(100).optional(),
  })
  .strict();

const MaterialAssetMetadataRecordSchema = z
  .object({
    subcategory: z.string().trim().min(1).max(80).optional(),
    originalName: z.string().trim().min(1).max(180).optional(),
    sellingPoints: z.array(z.string().trim().min(1).max(120)).max(6).optional(),
    batchId: z.string().trim().min(1).max(80).optional(),
    position: z.number().int().min(0).max(100).optional(),
  })
  .strict();

export const MaterialAssetDocumentSchema = z
  .object({
    _id: z.string().min(1),
    owner_id: z.string().min(1),
    workflow_id: z.string().min(1).optional(),
    run_id: z.string().min(1).optional(),
    node_id: z.string().min(1).optional(),
    node_type: z.string().min(1).optional(),
    category: MaterialAssetCategorySchema,
    kind: MaterialAssetKindSchema,
    source: MaterialAssetSourceSchema,
    title: z.string().trim().min(1).max(160),
    url: z.string().trim().min(1),
    thumbnail_url: z.string().trim().min(1).optional(),
    r2_key: z.string().trim().min(1).optional(),
    content_type: z.string().trim().min(1).optional(),
    size: z.number().int().nonnegative().optional(),
    input_prompt: MaterialInputPromptSchema.optional(),
    metadata: MaterialAssetMetadataDocumentSchema.optional(),
    // 入库时对「类目 + 子类 + 标题 + 卖点」文本做的向量，供 Agent 语义检索。
    // 维度与 MATERIAL_EMBEDDING_DIMS 一致；缺失表示尚未向量化（可被回填脚本补齐）。
    embedding: z.array(z.number()).optional(),
    embedding_text: z.string().trim().min(1).max(4000).optional(),
    embedding_model: z.string().trim().min(1).max(120).optional(),
    created_at: z.date(),
    updated_at: z.date(),
  })
  .strict();
export type MaterialAssetDocument = z.infer<typeof MaterialAssetDocumentSchema>;

export const MaterialAssetRecordSchema = z
  .object({
    id: z.string().min(1),
    ownerId: z.string().min(1),
    workflowId: z.string().optional(),
    runId: z.string().optional(),
    nodeId: z.string().optional(),
    nodeType: z.string().optional(),
    category: MaterialAssetCategorySchema,
    kind: MaterialAssetKindSchema,
    source: MaterialAssetSourceSchema,
    title: z.string().min(1),
    url: z.string().min(1),
    thumbnailUrl: z.string().optional(),
    r2Key: z.string().optional(),
    contentType: z.string().optional(),
    size: z.number().int().nonnegative().optional(),
    inputPrompt: MaterialInputPromptSchema.optional(),
    metadata: MaterialAssetMetadataRecordSchema.optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type MaterialAssetRecord = z.infer<typeof MaterialAssetRecordSchema>;

export const ListMaterialAssetsInputSchema = z
  .object({
    ownerId: z.string().min(1),
    workflowId: z.string().min(1).optional(),
    category: MaterialAssetCategorySchema.optional(),
    kind: MaterialAssetKindSchema.optional(),
    limit: z.number().int().min(1).max(500).default(200),
  })
  .strict();
export type ListMaterialAssetsInput = z.input<typeof ListMaterialAssetsInputSchema>;

export const UpsertWorkflowMaterialAssetInputSchema = z
  .object({
    ownerId: z.string().min(1),
    workflowId: z.string().min(1),
    runId: z.string().min(1),
    nodeId: z.string().min(1),
    nodeType: z.string().min(1),
    kind: MaterialAssetKindSchema,
    title: z.string().trim().min(1).max(160),
    url: z.string().trim().min(1),
    thumbnailUrl: z.string().trim().min(1).optional(),
    r2Key: z.string().trim().min(1).optional(),
    contentType: z.string().trim().min(1).optional(),
    size: z.number().int().nonnegative().optional(),
    inputPrompt: MaterialInputPromptSchema.optional(),
  })
  .strict();
export type UpsertWorkflowMaterialAssetInput = z.infer<
  typeof UpsertWorkflowMaterialAssetInputSchema
>;

export const CreateUserMaterialAssetInputSchema = z
  .object({
    ownerId: z.string().min(1),
    category: UserUploadMaterialAssetCategorySchema,
    kind: MaterialAssetKindSchema.default('image'),
    title: z.string().trim().min(1).max(160),
    url: z.string().trim().min(1),
    thumbnailUrl: z.string().trim().min(1).optional(),
    r2Key: z.string().trim().min(1).optional(),
    contentType: z.string().trim().min(1).optional(),
    size: z.number().int().nonnegative().optional(),
    inputPrompt: MaterialInputPromptSchema.optional(),
    metadata: MaterialAssetMetadataRecordSchema.optional(),
    embedding: z.array(z.number()).optional(),
    embeddingText: z.string().trim().min(1).max(4000).optional(),
    embeddingModel: z.string().trim().min(1).max(120).optional(),
  })
  .strict();
export type CreateUserMaterialAssetInput = z.infer<typeof CreateUserMaterialAssetInputSchema>;
