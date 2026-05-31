import { z } from 'zod';

const MaterialInputPromptSchema = z.preprocess((value) => {
  if (typeof value !== 'string') return value;
  return value.trim().slice(0, 100);
}, z.string().max(100));

export const MaterialAssetKindSchema = z.enum(['image', 'video', 'audio']);
export type MaterialAssetKind = z.infer<typeof MaterialAssetKindSchema>;

export const MaterialAssetCategorySchema = z.enum(['my_assets', 'character', 'scene', 'item']);
export type MaterialAssetCategory = z.infer<typeof MaterialAssetCategorySchema>;

export const MaterialAssetSourceSchema = z.enum(['workflow_result', 'user_upload', 'manual']);
export type MaterialAssetSource = z.infer<typeof MaterialAssetSourceSchema>;

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
