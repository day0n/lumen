import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { deleteStudioProject, getStudioProject, updateStudioProject } from '@/server/projects';
import { UpdateProjectInputSchema } from '@lumen/db';

export const runtime = 'nodejs';

interface ProjectRouteContext {
  params: Promise<{
    projectId: string;
  }>;
}

export const GET = withApiRouteSpan(
  'GET /api/projects/:projectId',
  async (_request: Request, context: ProjectRouteContext) => {
    try {
      const { projectId } = await context.params;
      const project = await getStudioProject(projectId);

      if (!project) {
        return failJson('项目不存在', 404);
      }

      return okJson({ project });
    } catch (error) {
      return routeError(error);
    }
  },
);

export const PATCH = withApiRouteSpan(
  'PATCH /api/projects/:projectId',
  async (request: Request, context: ProjectRouteContext) => {
    try {
      const { projectId } = await context.params;
      const body = await readJson(request);
      const input = UpdateProjectInputSchema.parse(body);
      const project = await updateStudioProject(projectId, input);

      if (!project) {
        return failJson('项目不存在', 404);
      }

      return okJson({ project });
    } catch (error) {
      if (error instanceof SyntaxError) {
        return failJson('请求 JSON 格式不正确', 400);
      }
      return routeError(error);
    }
  },
);

export const DELETE = withApiRouteSpan(
  'DELETE /api/projects/:projectId',
  async (_request: Request, context: ProjectRouteContext) => {
    try {
      const { projectId } = await context.params;
      const deleted = await deleteStudioProject(projectId);

      if (!deleted) {
        return failJson('项目不存在', 404);
      }

      return okJson({ deleted: true });
    } catch (error) {
      return routeError(error);
    }
  },
);
