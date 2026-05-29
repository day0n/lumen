import { UnauthorizedError, requireStudioUser } from '@/server/auth';
import { ingestHotVideoFromUrl } from '@/server/hotVideos';
import { failJson, okJson, readJson, routeError } from '@/server/http';
import { TikTokScrapeError } from '@/server/tiktokScraper';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 200;

const ParseLinkSchema = z
  .object({
    url: z.string().trim().min(1, 'url 不能为空').max(500),
  })
  .strict();

export async function POST(request: Request) {
  try {
    const user = await requireStudioUser();
    const body = await readJson(request);
    const { url } = ParseLinkSchema.parse(body);
    const record = await ingestHotVideoFromUrl(url, { ownerUserId: user.clerkUserId });
    return okJson(record);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return failJson(error.message, 401);
    }
    if (error instanceof TikTokScrapeError) {
      return failJson(error.message, 400);
    }
    if (error instanceof SyntaxError) {
      return failJson('请求体不是合法 JSON', 400);
    }
    return routeError(error);
  }
}
