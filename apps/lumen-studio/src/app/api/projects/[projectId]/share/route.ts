import { failJson, okJson, routeError } from '@/server/http';
import { createProjectShare } from '@/server/projects';

export const runtime = 'nodejs';

interface ProjectShareRouteContext {
  params: Promise<{
    projectId: string;
  }>;
}

export async function POST(request: Request, context: ProjectShareRouteContext) {
  try {
    const { projectId } = await context.params;
    const { shareId, project } = await createProjectShare(projectId);
    const url = new URL(request.url);
    const shareUrl = `${url.origin}/share/${shareId}`;

    return okJson({ project, shareId, shareUrl });
  } catch (error) {
    if (error instanceof Error && error.message === '项目不存在') {
      return failJson('项目不存在', 404);
    }
    return routeError(error);
  }
}
