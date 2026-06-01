import { z } from 'zod';

import { translate } from '@/i18n/messages';
import { requireStudioUser } from '@/server/auth';
import { GeminiNotConfiguredError, generateGeminiText } from '@/server/gemini';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { UserUploadMaterialAssetCategorySchema } from '@lumen/db';

export const runtime = 'nodejs';

const SellingPointInputSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    category: UserUploadMaterialAssetCategorySchema,
    subcategory: z.string().trim().max(80).optional(),
  })
  .strict();

export const POST = withApiRouteSpan(
  'POST /api/material-assets/selling-points',
  async (request: Request) => {
    const locale = resolveRequestLocale(request);
    try {
      await requireStudioUser();
      const input = SellingPointInputSchema.parse(await readJson(request));
      const text = await generateGeminiText(buildSellingPointPrompt(input, locale));
      const points = parseSellingPoints(text).slice(0, 3);

      if (points.length === 0) {
        return failJson(translate(locale, 'api.materialSellingPointsEmpty'), 502);
      }

      return okJson({ points });
    } catch (error) {
      if (error instanceof GeminiNotConfiguredError) {
        return failJson(translate(locale, 'api.materialSellingPointsUnavailable'), 503);
      }
      if (error instanceof SyntaxError) {
        return failJson(translate(locale, 'api.invalidJson'), 400);
      }
      return routeError(error, locale);
    }
  },
);

function buildSellingPointPrompt(
  input: z.infer<typeof SellingPointInputSchema>,
  locale: 'en' | 'zh',
): string {
  const language = locale === 'zh' ? '简体中文' : 'English';
  const typeLabel = {
    item: locale === 'zh' ? '商品素材' : 'product asset',
    character: locale === 'zh' ? '出镜角色素材' : 'presenter asset',
    scene: locale === 'zh' ? '展示场景素材' : 'display-scene asset',
  }[input.category];

  return [
    `You are a TikTok Shop product creative strategist. Write in ${language}.`,
    'Generate exactly 3 short selling points for an asset upload form.',
    'Each point must be concrete, benefits-oriented, and useful for later video generation.',
    'Avoid exaggerated medical, financial, or guarantee claims.',
    'Return only a JSON string array. No markdown.',
    '',
    `Asset type: ${typeLabel}`,
    `Name: ${input.title}`,
    `Category: ${input.subcategory || 'general'}`,
  ].join('\n');
}

function parseSellingPoints(text: string): string[] {
  const normalized = text.trim();
  const jsonText = extractJsonArray(normalized);
  if (jsonText) {
    try {
      const value = JSON.parse(jsonText);
      if (Array.isArray(value)) return normalizePoints(value);
    } catch {
      // Fall back to line parsing below.
    }
  }

  return normalizePoints(
    normalized.split(/\r?\n/).map((line) => line.replace(/^\s*(?:[-*]|\d+[.)])\s*/, '').trim()),
  );
}

function extractJsonArray(text: string): string | null {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end <= start) return null;
  return text.slice(start, end + 1);
}

function normalizePoints(value: unknown[]): string[] {
  const points: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const point = item.trim().replace(/^["']|["']$/g, '');
    if (!point) continue;
    points.push(point.slice(0, 120));
  }
  return Array.from(new Set(points)).slice(0, 3);
}
