import { okJson, routeError, withApiRouteSpan } from '@/server/http';
import { listStudioProjectHistory } from '@/server/projects';

export const runtime = 'nodejs';

interface ProjectHistoryRouteContext {
  params: Promise<{
    projectId: string;
  }>;
}

export const GET = withApiRouteSpan(
  'GET /api/projects/:projectId/history',
  async (_request: Request, context: ProjectHistoryRouteContext) => {
    try {
      const { projectId } = await context.params;
      const history = await listStudioProjectHistory(projectId);

      if (history.length === 0) {
        return okJson({ history });
      }

      return okJson({ history });
    } catch (error) {
      return routeError(error);
    }
  },
);
