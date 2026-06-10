import { translate } from '@/i18n/messages';
import { getClerkUserId } from '@/server/auth';
import { listHotVideos } from '@/server/hotVideos';
import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import {
  HotVideoOwnerScopeSchema,
  HotVideoPublishedRangeSchema,
  HotVideoSortSchema,
  type ListHotVideosInput,
} from '@lumen/db';

export const runtime = 'nodejs';

export const GET = withApiRouteSpan('GET /api/hot-videos', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const url = new URL(request.url);
    const ownerScope = HotVideoOwnerScopeSchema.optional().parse(
      url.searchParams.get('owner') ?? undefined,
    );

    const clerkUserId = await getClerkUserId();
    let ownerUserId: string | undefined = clerkUserId ?? undefined;
    if (ownerScope === 'me') {
      if (!clerkUserId) {
        return failJson(translate(locale, 'hotVideos.loginToViewMine'), 401);
      }
      ownerUserId = clerkUserId;
    }

    const input: ListHotVideosInput = {
      query: url.searchParams.get('q') ?? undefined,
      region: url.searchParams.get('region') ?? undefined,
      category: url.searchParams.get('category') ?? undefined,
      videoType: url.searchParams.get('videoType') ?? undefined,
      publishedRange: HotVideoPublishedRangeSchema.optional().parse(
        url.searchParams.get('published') ?? undefined,
      ),
      gmvMin: parseFloatParam(url.searchParams.get('gmvMin')),
      sort: HotVideoSortSchema.optional().parse(url.searchParams.get('sort') ?? undefined),
      ownerScope,
      ownerUserId,
      limit: parseIntParam(url.searchParams.get('limit'), 24),
      skip: parseIntParam(url.searchParams.get('skip'), 0),
    };

    const result = await listHotVideos(input, locale);
    return okJson(result);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return failJson(translate(locale, 'hotVideos.badQuery'), 400);
    }
    return routeError(error, locale);
  }
});

function parseIntParam(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function parseFloatParam(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
