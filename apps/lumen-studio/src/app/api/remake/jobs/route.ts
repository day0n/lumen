import { requireStudioUser } from '@/server/auth';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { createRemakeJob, listRemakeJobsForUser } from '@/server/remake/jobs';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 200;

const ReferenceSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1).max(180),
    value: z.string().trim().min(1).max(500),
    source: z.enum(['link', 'video']),
    title: z.string().trim().max(240).optional(),
    productName: z.string().trim().max(120).optional(),
    category: z.string().trim().max(40).optional(),
    region: z.string().trim().max(40).optional(),
    thumbnailUrl: z.string().trim().url().optional(),
    previewUrl: z.string().trim().url().optional(),
  })
  .strict();

const SettingsSchema = z
  .object({
    aspectRatio: z.string().trim().default('9:16'),
    resolution: z.enum(['720p', '1080p']).default('720p'),
    language: z.enum(['zh', 'en']).optional(),
    durationSeconds: z.number().int().min(5).max(120).optional(),
  })
  .strict();

const CreateBodySchema = z
  .object({
    videoId: z.string().trim().max(120).optional(),
    reference: ReferenceSchema,
    productImageUrls: z.array(z.string().trim().url()).max(9).default([]),
    creatorImageUrls: z.array(z.string().trim().url()).max(2).optional(),
    environmentImageUrls: z.array(z.string().trim().url()).max(4).optional(),
    userPrompt: z.string().trim().max(1200).optional(),
    settings: SettingsSchema.optional(),
  })
  .strict();

export const POST = withApiRouteSpan('POST /api/remake/jobs', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const body = CreateBodySchema.parse(await readJson(request));
    const user = await requireStudioUser();
    const settings = body.settings;
    const view = await createRemakeJob({
      ownerId: user.id,
      ownerClerkUserId: user.clerkUserId,
      videoId: body.videoId,
      reference: body.reference,
      productImageUrls: body.productImageUrls,
      creatorImageUrls: body.creatorImageUrls ?? [],
      environmentImageUrls: body.environmentImageUrls ?? [],
      userPrompt: body.userPrompt,
      settings: {
        aspectRatio: settings?.aspectRatio ?? '9:16',
        resolution: settings?.resolution ?? '720p',
        language: settings?.language ?? locale,
        ...(settings?.durationSeconds ? { durationSeconds: settings.durationSeconds } : {}),
      },
      locale,
    });
    return okJson(view);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return failJson(locale === 'zh' ? '请求 JSON 无效' : 'Invalid JSON', 400);
    }
    return routeError(error, locale);
  }
});

export const GET = withApiRouteSpan('GET /api/remake/jobs', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const user = await requireStudioUser();
    const url = new URL(request.url);
    const limit = Math.min(
      100,
      Math.max(1, Number.parseInt(url.searchParams.get('limit') ?? '50', 10)),
    );
    const items = await listRemakeJobsForUser(user.id, { limit });
    return okJson({ items, total: items.length });
  } catch (error) {
    return routeError(error, locale);
  }
});
