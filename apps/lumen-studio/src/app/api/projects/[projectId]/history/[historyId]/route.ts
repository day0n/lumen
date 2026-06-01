import { translate } from '@/i18n/messages';
import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { getStudioProjectHistoryRecord } from '@/server/projects';

export const runtime = 'nodejs';

interface ProjectHistoryRecordRouteContext {
  params: Promise<{
    projectId: string;
    historyId: string;
  }>;
}

export const GET = withApiRouteSpan(
  'GET /api/projects/:projectId/history/:historyId',
  async (request: Request, context: ProjectHistoryRecordRouteContext) => {
    const locale = resolveRequestLocale(request);
    try {
      const { projectId, historyId } = await context.params;
      const history = await getStudioProjectHistoryRecord(projectId, historyId);

      if (!history) {
        return failJson(translate(locale, 'api.historyNotFound'), 404);
      }

      return okJson({ history });
    } catch (error) {
      return routeError(error, locale);
    }
  },
);
