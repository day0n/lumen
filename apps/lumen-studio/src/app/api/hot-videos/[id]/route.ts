import { getHotVideo } from '@/server/hotVideos';
import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
import { translate } from '@/i18n/messages';
import { resolveRequestLocale } from '@/server/locale';

export const runtime = 'nodejs';

interface HotVideoRouteContext {
  params: Promise<{
    id: string;
  }>;
}

export const GET = withApiRouteSpan(
  'GET /api/hot-videos/:id',
  async (request: Request, context: HotVideoRouteContext) => {
    const locale = resolveRequestLocale(request);
    try {
      const { id } = await context.params;
      const video = await getHotVideo(id, locale);

      if (!video) {
        return failJson(translate(locale, 'hotVideos.notFound'), 404);
      }

      return okJson({ video });
    } catch (error) {
      return routeError(error, locale);
    }
  },
);
