import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
import { createProjectShare } from '@/server/projects';
import { getPublicAppOrigin } from '@/server/public-url';

export const runtime = 'nodejs';

interface ProjectShareRouteContext {
  params: Promise<{
    projectId: string;
  }>;
}

export const POST = withApiRouteSpan(
  'POST /api/projects/:projectId/share',
  async (request: Request, context: ProjectShareRouteContext) => {
    try {
      const { projectId } = await context.params;
      const { shareId, project } = await createProjectShare(projectId);
      const shareUrl = `${getPublicAppOrigin(request)}/share/${shareId}`;

      return okJson({ project, shareId, shareUrl });
    } catch (error) {
      if (error instanceof Error && error.message === '项目不存在') {
        return failJson('项目不存在', 404);
      }
      return routeError(error);
    }
  },
);
