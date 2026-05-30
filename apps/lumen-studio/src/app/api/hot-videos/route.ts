import { getClerkUserId } from '@/server/auth';
import { listHotVideos } from '@/server/hotVideos';
import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
import {
  HotVideoOwnerScopeSchema,
  HotVideoPublishedRangeSchema,
  HotVideoSortSchema,
  type ListHotVideosInput,
} from '@lumen/db';

export const runtime = 'nodejs';

export const GET = withApiRouteSpan('GET /api/hot-videos', async (request: Request) => {
  try {
    const url = new URL(request.url);
    const ownerScope = HotVideoOwnerScopeSchema.optional().parse(
      url.searchParams.get('owner') ?? undefined,
    );

    let ownerUserId: string | undefined;
    if (ownerScope === 'me') {
      const clerkUserId = await getClerkUserId();
      if (!clerkUserId) {
        return failJson('请先登录后再查看已下载视频', 401);
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

    const result = await listHotVideos(input);
    return okJson(result);
  } catch (error) {
    if (error instanceof SyntaxError) {
      return failJson('请求参数解析失败', 400);
    }
    return routeError(error);
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
