import { listHomeFeaturedItems } from '@/server/home';
import { okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';

export const runtime = 'nodejs';

export const GET = withApiRouteSpan('GET /api/home/featured', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const items = await listHomeFeaturedItems(locale);
    return okJson({ items });
  } catch (error) {
    return routeError(error, locale);
  }
});
