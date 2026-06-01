import {
  buildTiktokDashboardMock,
  normalizeTiktokDashboardQuery,
} from '@/lib/tiktok-dashboard-mock';
import { okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = withApiRouteSpan('GET /api/tiktok-dashboard', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const url = new URL(request.url);
    const query = normalizeTiktokDashboardQuery({
      range: url.searchParams.get('range'),
      region: url.searchParams.get('region'),
      channel: url.searchParams.get('channel'),
      objective: url.searchParams.get('objective'),
    });

    return okJson(buildTiktokDashboardMock(query, locale));
  } catch (error) {
    return routeError(error, locale);
  }
});
