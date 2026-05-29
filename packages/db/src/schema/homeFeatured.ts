import { z } from 'zod';

/**
 * 主页顶部精选轮播。cover_url 支持站内 public 路径或远程 URL。
 */

export const HomeFeaturedStatusSchema = z.enum(['active', 'hidden']);
export type HomeFeaturedStatus = z.infer<typeof HomeFeaturedStatusSchema>;

const HexColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'expected hex color like #79e4ff');

export const HomeFeaturedItemDocumentSchema = z
  .object({
    _id: z.string().min(1),
    badge: z.string().trim().min(1).max(40),
    title: z.string().trim().min(1).max(120),
    subtitle: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(400),
    stats_label: z.string().trim().max(80).optional(),
    cta_label: z.string().trim().max(40).optional(),
    cta_href: z.string().trim().max(2048).optional(),
    cover_url: z.string().trim().min(1).max(2048).optional(),
    background_css: z.string().trim().min(1).max(600),
    accent_color: HexColorSchema,
    stills: z.array(HexColorSchema).max(12).default([]),
    sort_order: z.number().int(),
    status: HomeFeaturedStatusSchema.default('active'),
    created_at: z.date(),
    updated_at: z.date(),
  })
  .strict();
export type HomeFeaturedItemDocument = z.infer<typeof HomeFeaturedItemDocumentSchema>;

export const HomeFeaturedItemRecordSchema = z
  .object({
    id: z.string().min(1),
    badge: z.string().min(1),
    title: z.string().min(1),
    subtitle: z.string().min(1),
    description: z.string().min(1),
    statsLabel: z.string().optional(),
    ctaLabel: z.string().optional(),
    ctaHref: z.string().optional(),
    coverUrl: z.string().optional(),
    backgroundCss: z.string().min(1),
    accentColor: z.string().min(1),
    stills: z.array(z.string()).default([]),
    sortOrder: z.number().int(),
    status: HomeFeaturedStatusSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type HomeFeaturedItemRecord = z.infer<typeof HomeFeaturedItemRecordSchema>;

export const CreateHomeFeaturedItemInputSchema = z
  .object({
    badge: z.string().trim().min(1).max(40),
    title: z.string().trim().min(1).max(120),
    subtitle: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(400),
    statsLabel: z.string().trim().max(80).optional(),
    ctaLabel: z.string().trim().max(40).optional(),
    ctaHref: z.string().trim().max(2048).optional(),
    coverUrl: z.string().trim().min(1).max(2048).optional(),
    backgroundCss: z.string().trim().min(1).max(600),
    accentColor: HexColorSchema,
    stills: z.array(HexColorSchema).max(12).optional(),
    sortOrder: z.number().int().optional(),
    status: HomeFeaturedStatusSchema.optional(),
  })
  .strict();
export type CreateHomeFeaturedItemInput = z.input<typeof CreateHomeFeaturedItemInputSchema>;
