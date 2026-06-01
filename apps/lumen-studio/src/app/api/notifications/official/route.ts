import { okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { listOfficialNotifications } from '@/server/notifications';

export const runtime = 'nodejs';

export const GET = withApiRouteSpan('GET /api/notifications/official', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const result = await listOfficialNotifications(locale);
    return okJson(result);
  } catch (error) {
    return routeError(error, locale);
  }
});
