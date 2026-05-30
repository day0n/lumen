import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
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
  async (_request: Request, context: ProjectHistoryRecordRouteContext) => {
    try {
      const { projectId, historyId } = await context.params;
      const history = await getStudioProjectHistoryRecord(projectId, historyId);

      if (!history) {
        return failJson('历史记录不存在', 404);
      }

      return okJson({ history });
    } catch (error) {
      return routeError(error);
    }
  },
);
