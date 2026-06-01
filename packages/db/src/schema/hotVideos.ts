import { z } from 'zod';

/**
 * 爆款视频列表 / 详情。
 * - metrics 拆 numeric (排序) + label (展示) 两套字段。
 * - 不存 publishedDaysAgo 这种相对时间，前端从 published_at 自己算。
 */

export const HotVideoStatusSchema = z.enum(['active', 'hidden']);
export type HotVideoStatus = z.infer<typeof HotVideoStatusSchema>;

export const HotVideoSourcePlatformSchema = z.enum(['tiktok', 'fastmoss', 'manual']);
export type HotVideoSourcePlatform = z.infer<typeof HotVideoSourcePlatformSchema>;

const HexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'expected hex color like #79e4ff');

export const HotVideoMetricsDocumentSchema = z
  .object({
    sales: z.number().int().nonnegative().default(0),
    revenue_usd: z.number().nonnegative().default(0),
    revenue_label: z.string().trim().max(40),
    views_count: z.number().int().nonnegative().default(0),
    views_label: z.string().trim().max(40),
    roas: z.number().nonnegative().default(0),
  })
  .strict();

export const HotVideoAnalysisDocumentSchema = z
  .object({
    hook: z.string().trim().max(280),
    angle: z.string().trim().max(120),
    score: z.number().min(0).max(100).default(0),
    tags: z.array(z.string().trim().max(40)).max(20).default([]),
    structure: z.array(z.string().trim().max(80)).max(20).default([]),
  })
  .strict();

const HotVideoMetricsTranslationSchema = z
  .object({
    revenueLabel: z.string().trim().max(40).optional(),
    viewsLabel: z.string().trim().max(40).optional(),
  })
  .strict();

const HotVideoAnalysisTranslationSchema = z
  .object({
    hook: z.string().trim().max(280).optional(),
    angle: z.string().trim().max(120).optional(),
    tags: z.array(z.string().trim().max(40)).max(20).optional(),
    structure: z.array(z.string().trim().max(80)).max(20).optional(),
  })
  .strict();

const HotVideoTranslationSchema = z
  .object({
    title: z.string().trim().min(1).max(240).optional(),
    productName: z.string().trim().min(1).max(120).optional(),
    region: z.string().trim().min(1).max(40).optional(),
    category: z.string().trim().min(1).max(40).optional(),
    videoType: z.string().trim().min(1).max(40).optional(),
    metrics: HotVideoMetricsTranslationSchema.optional(),
    analysis: HotVideoAnalysisTranslationSchema.optional(),
  })
  .strict();

const HotVideoTranslationsSchema = z
  .object({
    en: HotVideoTranslationSchema.optional(),
    zh: HotVideoTranslationSchema.optional(),
  })
  .strict();

export type HotVideoTranslations = z.infer<typeof HotVideoTranslationsSchema>;

export const HotVideoDocumentSchema = z
  .object({
    _id: z.string().min(1),
    /** Clerk user id of the user who ingested this record. Optional for legacy/seed rows. */
    owner_user_id: z.string().trim().max(120).optional(),
    source_platform: HotVideoSourcePlatformSchema,
    source_url: z.string().trim().url().optional(),
    external_id: z.string().trim().max(120).optional(),
    title: z.string().trim().min(1).max(240),
    product_name: z.string().trim().min(1).max(120),
    author_handle: z.string().trim().max(120).optional(),
    thumbnail_url: z.string().trim().url().optional(),
    preview_url: z.string().trim().url().optional(),
    region: z.string().trim().min(1).max(40),
    category: z.string().trim().min(1).max(40),
    video_type: z.string().trim().min(1).max(40),
    palette_css: z.string().trim().min(1).max(600),
    accent_color: HexColorSchema,
    metrics: HotVideoMetricsDocumentSchema,
    analysis: HotVideoAnalysisDocumentSchema,
    translations: HotVideoTranslationsSchema.optional(),
    published_at: z.date(),
    ingested_at: z.date().optional(),
    status: HotVideoStatusSchema.default('active'),
    created_at: z.date(),
    updated_at: z.date(),
  })
  .strict();
export type HotVideoDocument = z.infer<typeof HotVideoDocumentSchema>;

export const HotVideoMetricsRecordSchema = z
  .object({
    sales: z.number().int().nonnegative(),
    revenueUsd: z.number().nonnegative(),
    revenueLabel: z.string(),
    viewsCount: z.number().int().nonnegative(),
    viewsLabel: z.string(),
    roas: z.number().nonnegative(),
  })
  .strict();
export type HotVideoMetricsRecord = z.infer<typeof HotVideoMetricsRecordSchema>;

export const HotVideoAnalysisRecordSchema = z
  .object({
    hook: z.string(),
    angle: z.string(),
    score: z.number(),
    tags: z.array(z.string()),
    structure: z.array(z.string()),
  })
  .strict();
export type HotVideoAnalysisRecord = z.infer<typeof HotVideoAnalysisRecordSchema>;

export const HotVideoRecordSchema = z
  .object({
    id: z.string().min(1),
    /** Clerk user id of the user who ingested this video. */
    ownerUserId: z.string().optional(),
    sourcePlatform: HotVideoSourcePlatformSchema,
    sourceUrl: z.string().optional(),
    externalId: z.string().optional(),
    title: z.string(),
    productName: z.string(),
    authorHandle: z.string().optional(),
    thumbnailUrl: z.string().optional(),
    previewUrl: z.string().optional(),
    region: z.string(),
    category: z.string(),
    videoType: z.string(),
    paletteCss: z.string(),
    accentColor: z.string(),
    metrics: HotVideoMetricsRecordSchema,
    analysis: HotVideoAnalysisRecordSchema,
    publishedAt: z.string().datetime(),
    status: HotVideoStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type HotVideoRecord = z.infer<typeof HotVideoRecordSchema>;

export const HotVideoSortSchema = z.enum(['sales', 'revenue', 'views', 'roas', 'publishedAt']);
export type HotVideoSort = z.infer<typeof HotVideoSortSchema>;

export const HotVideoPublishedRangeSchema = z.enum(['7d', '30d', 'all']);
export type HotVideoPublishedRange = z.infer<typeof HotVideoPublishedRangeSchema>;

export const HotVideoOwnerScopeSchema = z.enum(['all', 'me']);
export type HotVideoOwnerScope = z.infer<typeof HotVideoOwnerScopeSchema>;

export const ListHotVideosInputSchema = z
  .object({
    query: z.string().trim().max(120).optional(),
    region: z.string().trim().max(40).optional(),
    category: z.string().trim().max(40).optional(),
    videoType: z.string().trim().max(40).optional(),
    publishedRange: HotVideoPublishedRangeSchema.default('all'),
    gmvMin: z.number().nonnegative().optional(),
    sort: HotVideoSortSchema.default('publishedAt'),
    /** When 'me', only rows whose owner_user_id matches `ownerUserId` are returned. */
    ownerScope: HotVideoOwnerScopeSchema.default('all'),
    /** Required when ownerScope = 'me'. Ignored otherwise. */
    ownerUserId: z.string().trim().max(120).optional(),
    limit: z.number().int().min(1).max(60).default(24),
    skip: z.number().int().min(0).default(0),
  })
  .strict();
export type ListHotVideosInput = z.input<typeof ListHotVideosInputSchema>;

export const CreateHotVideoInputSchema = z
  .object({
    /** Clerk user id of the ingester. Optional for legacy/admin seeds. */
    ownerUserId: z.string().trim().max(120).optional(),
    sourcePlatform: HotVideoSourcePlatformSchema,
    sourceUrl: z.string().trim().url().optional(),
    externalId: z.string().trim().max(120).optional(),
    title: z.string().trim().min(1).max(240),
    productName: z.string().trim().min(1).max(120),
    authorHandle: z.string().trim().max(120).optional(),
    thumbnailUrl: z.string().trim().url().optional(),
    previewUrl: z.string().trim().url().optional(),
    region: z.string().trim().min(1).max(40),
    category: z.string().trim().min(1).max(40),
    videoType: z.string().trim().min(1).max(40),
    paletteCss: z.string().trim().min(1).max(600),
    accentColor: HexColorSchema,
    metrics: z
      .object({
        sales: z.number().int().nonnegative(),
        revenueUsd: z.number().nonnegative(),
        revenueLabel: z.string().trim().max(40),
        viewsCount: z.number().int().nonnegative(),
        viewsLabel: z.string().trim().max(40),
        roas: z.number().nonnegative(),
      })
      .strict(),
    analysis: z
      .object({
        hook: z.string().trim().max(280),
        angle: z.string().trim().max(120),
        score: z.number().min(0).max(100),
        tags: z.array(z.string().trim().max(40)).max(20),
        structure: z.array(z.string().trim().max(80)).max(20),
      })
      .strict(),
    translations: HotVideoTranslationsSchema.optional(),
    publishedAt: z.date(),
    status: HotVideoStatusSchema.optional(),
  })
  .strict();
export type CreateHotVideoInput = z.input<typeof CreateHotVideoInputSchema>;
