import { translate } from '@/i18n/messages';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
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
  async (request: Request, context: ProjectRouteContext) => {
    const locale = resolveRequestLocale(request);
    try {
      const { projectId } = await context.params;
      const project = await getStudioProject(projectId);

      if (!project) {
        return failJson(translate(locale, 'api.projectNotFound'), 404);
      }

      return okJson({ project });
    } catch (error) {
      return routeError(error, locale);
    }
  },
);

export const PATCH = withApiRouteSpan(
  'PATCH /api/projects/:projectId',
  async (request: Request, context: ProjectRouteContext) => {
    const locale = resolveRequestLocale(request);
    try {
      const { projectId } = await context.params;
      const body = await readJson(request);
      const input = UpdateProjectInputSchema.parse(body);
      const project = await updateStudioProject(projectId, input);

      if (!project) {
        return failJson(translate(locale, 'api.projectNotFound'), 404);
      }

      return okJson({ project });
    } catch (error) {
      if (error instanceof SyntaxError) {
        return failJson(translate(locale, 'api.invalidJson'), 400);
      }
      return routeError(error, locale);
    }
  },
);

export const DELETE = withApiRouteSpan(
  'DELETE /api/projects/:projectId',
  async (request: Request, context: ProjectRouteContext) => {
    const locale = resolveRequestLocale(request);
    try {
      const { projectId } = await context.params;
      const deleted = await deleteStudioProject(projectId);

      if (!deleted) {
        return failJson(translate(locale, 'api.projectNotFound'), 404);
      }

      return okJson({ deleted: true });
    } catch (error) {
      return routeError(error, locale);
    }
  },
);
