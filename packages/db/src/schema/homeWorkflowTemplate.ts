import { z } from 'zod';
import { ProjectCanvasSchema } from './project.js';

export const HomeWorkflowTemplateStatusSchema = z.enum(['active', 'hidden']);
export type HomeWorkflowTemplateStatus = z.infer<typeof HomeWorkflowTemplateStatusSchema>;

export const HomeWorkflowTemplateMediaTypeSchema = z.enum(['image', 'video']);
export type HomeWorkflowTemplateMediaType = z.infer<typeof HomeWorkflowTemplateMediaTypeSchema>;

const HomeWorkflowTemplateTranslationSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    subtitle: z.string().trim().min(1).max(160).optional(),
    description: z.string().trim().min(1).max(500).optional(),
    categoryLabel: z.string().trim().min(1).max(60).optional(),
    badge: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

const HomeWorkflowTemplateTranslationsSchema = z
  .object({
    en: HomeWorkflowTemplateTranslationSchema.optional(),
    zh: HomeWorkflowTemplateTranslationSchema.optional(),
  })
  .strict();

export type HomeWorkflowTemplateTranslations = z.infer<
  typeof HomeWorkflowTemplateTranslationsSchema
>;

const UrlSchema = z.string().trim().min(1).max(2048);

export const HomeWorkflowTemplateDocumentSchema = z
  .object({
    _id: z.string().min(1),
    category_id: z.string().trim().min(1).max(80),
    category_label: z.string().trim().min(1).max(60),
    category_sort_order: z.number().int(),
    title: z.string().trim().min(1).max(120),
    subtitle: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(500),
    badge: z.string().trim().min(1).max(40),
    translations: HomeWorkflowTemplateTranslationsSchema.optional(),
    tags: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
    cover_url: UrlSchema,
    media_type: HomeWorkflowTemplateMediaTypeSchema,
    source_project_id: z.string().trim().min(1).max(160),
    source_run_id: z.string().trim().min(1).max(160),
    result_node_id: z.string().trim().min(1).max(160),
    result_url: UrlSchema,
    last_run_at: z.date(),
    usage_count: z.number().int().nonnegative().default(0),
    sort_order: z.number().int(),
    status: HomeWorkflowTemplateStatusSchema.default('active'),
    search_text: z.string().trim().max(2000).default(''),
    canvas: ProjectCanvasSchema,
    created_at: z.date(),
    updated_at: z.date(),
  })
  .strict();
export type HomeWorkflowTemplateDocument = z.infer<typeof HomeWorkflowTemplateDocumentSchema>;

export const HomeWorkflowTemplateRecordSchema = z
  .object({
    id: z.string().min(1),
    categoryId: z.string().min(1),
    categoryLabel: z.string().min(1),
    categorySortOrder: z.number().int(),
    title: z.string().min(1),
    subtitle: z.string().min(1),
    description: z.string().min(1),
    badge: z.string().min(1),
    tags: z.array(z.string()).default([]),
    coverUrl: z.string().min(1),
    mediaType: HomeWorkflowTemplateMediaTypeSchema,
    sourceProjectId: z.string().min(1),
    sourceRunId: z.string().min(1),
    resultNodeId: z.string().min(1),
    resultUrl: z.string().min(1),
    lastRunAt: z.string().datetime(),
    usageCount: z.number().int().nonnegative(),
    sortOrder: z.number().int(),
    status: HomeWorkflowTemplateStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type HomeWorkflowTemplateRecord = z.infer<typeof HomeWorkflowTemplateRecordSchema>;

export const HomeWorkflowTemplateCloneRecordSchema = HomeWorkflowTemplateRecordSchema.extend({
  canvas: ProjectCanvasSchema,
}).strict();
export type HomeWorkflowTemplateCloneRecord = z.infer<typeof HomeWorkflowTemplateCloneRecordSchema>;

export const HomeWorkflowTemplateCategoryRecordSchema = z
  .object({
    id: z.string().min(1),
    label: z.string().min(1),
    sortOrder: z.number().int(),
    count: z.number().int().nonnegative(),
  })
  .strict();
export type HomeWorkflowTemplateCategoryRecord = z.infer<
  typeof HomeWorkflowTemplateCategoryRecordSchema
>;

export const HomeWorkflowTemplateListRecordSchema = z
  .object({
    categories: z.array(HomeWorkflowTemplateCategoryRecordSchema),
    items: z.array(HomeWorkflowTemplateRecordSchema),
  })
  .strict();
export type HomeWorkflowTemplateListRecord = z.infer<typeof HomeWorkflowTemplateListRecordSchema>;

export const UpsertHomeWorkflowTemplateInputSchema = HomeWorkflowTemplateDocumentSchema.omit({
  created_at: true,
  updated_at: true,
}).strict();
export type UpsertHomeWorkflowTemplateInput = z.input<typeof UpsertHomeWorkflowTemplateInputSchema>;
