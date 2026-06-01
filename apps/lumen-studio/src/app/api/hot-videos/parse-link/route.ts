import { translate } from '@/i18n/messages';
import { UnauthorizedError, requireStudioUser } from '@/server/auth';
import { ingestHotVideoFromUrl } from '@/server/hotVideos';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { TikTokScrapeError } from '@/server/tiktokScraper';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 200;

const ParseLinkSchema = z
  .object({
    url: z.string().trim().min(1).max(500),
  })
  .strict();

export const POST = withApiRouteSpan(
  'POST /api/hot-videos/parse-link',
  async (request: Request) => {
    const locale = resolveRequestLocale(request);
    try {
      const user = await requireStudioUser();
      const body = await readJson(request);
      const { url } = ParseLinkSchema.parse(body);
      const record = await ingestHotVideoFromUrl(url, { ownerUserId: user.clerkUserId, locale });
      return okJson(record);
    } catch (error) {
      if (error instanceof UnauthorizedError) {
        return routeError(error, locale);
      }
      if (error instanceof TikTokScrapeError) {
        return failJson(error.message, 400);
      }
      if (error instanceof SyntaxError) {
        return failJson(translate(locale, 'api.invalidJson'), 400);
      }
      return routeError(error, locale);
    }
  },
);
