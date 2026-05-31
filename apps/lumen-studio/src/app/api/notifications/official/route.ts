import { okJson, routeError, withApiRouteSpan } from '@/server/http';
import { listOfficialNotifications } from '@/server/notifications';

export const runtime = 'nodejs';

export const GET = withApiRouteSpan('GET /api/notifications/official', async () => {
  try {
    const result = await listOfficialNotifications();
    return okJson(result);
  } catch (error) {
    return routeError(error);
  }
});
