import { translate } from '@/i18n/messages';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { createStudioProject, listStudioProjects } from '@/server/projects';
import { CreateProjectInputSchema } from '@lumen/db';

export const runtime = 'nodejs';

export const GET = withApiRouteSpan('GET /api/projects', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const url = new URL(request.url);
    const query = url.searchParams.get('q') ?? undefined;
    const limitParam = url.searchParams.get('limit');
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const folderIdParam = url.searchParams.get('folderId');
    const folderId =
      folderIdParam === 'uncategorized'
        ? 'uncategorized'
        : folderIdParam && folderIdParam.trim().length > 0
          ? folderIdParam
          : undefined;

    const projects = await listStudioProjects({ query, limit, folderId });
    return okJson({ projects });
  } catch (error) {
    return routeError(error, locale);
  }
});

export const POST = withApiRouteSpan('POST /api/projects', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const body = await readJson(request);
    const input = CreateProjectInputSchema.omit({ ownerId: true }).partial().parse(body);
    const project = await createStudioProject({
      ...input,
      locale,
    });
    return okJson({ project }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return failJson(translate(locale, 'api.invalidJson'), 400);
    }
    return routeError(error, locale);
  }
});
