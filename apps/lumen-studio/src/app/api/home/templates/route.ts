import { listHomeWorkflowTemplates } from '@/server/homeWorkflowTemplates';
import { okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';

export const runtime = 'nodejs';

export const GET = withApiRouteSpan('GET /api/home/templates', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const templates = await listHomeWorkflowTemplates(locale);
    return okJson(templates);
  } catch (error) {
    return routeError(error, locale);
  }
});
