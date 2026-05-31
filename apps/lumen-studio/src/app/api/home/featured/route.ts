import { listHomeFeaturedItems } from '@/server/home';
import { okJson, routeError, withApiRouteSpan } from '@/server/http';

export const runtime = 'nodejs';

export const GET = withApiRouteSpan('GET /api/home/featured', async () => {
  try {
    const items = await listHomeFeaturedItems();
    return okJson({ items });
  } catch (error) {
    return routeError(error);
  }
});
