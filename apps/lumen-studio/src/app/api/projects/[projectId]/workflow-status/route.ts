import { translate } from '@/i18n/messages';
import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { getStudioWorkflowNodeStatus } from '@/server/workflow-status';

export const runtime = 'nodejs';

interface WorkflowStatusRouteContext {
  params: Promise<{
    projectId: string;
  }>;
}

export const GET = withApiRouteSpan(
  'GET /api/projects/:projectId/workflow-status',
  async (request: Request, context: WorkflowStatusRouteContext) => {
    const locale = resolveRequestLocale(request);
    try {
      const { projectId } = await context.params;
      const nodeIds = new URL(request.url).searchParams.get('nodeIds')?.split(',') ?? [];
      const results = await getStudioWorkflowNodeStatus(projectId, nodeIds);
      return okJson({ results });
    } catch (error) {
      if (error instanceof Error && error.message === 'project not found') {
        return failJson(translate(locale, 'api.projectNotFound'), 404);
      }
      return routeError(error, locale);
    }
  },
);
