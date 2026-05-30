import { okJson, routeError, withApiRouteSpan } from '@/server/http';
import { getCurrentUser } from '@/server/me';

export const runtime = 'nodejs';

export const GET = withApiRouteSpan('GET /api/me', async () => {
  try {
    const result = await getCurrentUser();
    return okJson(result);
  } catch (error) {
    return routeError(error);
  }
});
