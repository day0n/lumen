import { okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { getCurrentUser } from '@/server/me';

export const runtime = 'nodejs';

export const GET = withApiRouteSpan('GET /api/me', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const result = await getCurrentUser();
    return okJson(result);
  } catch (error) {
    return routeError(error, locale);
  }
});
