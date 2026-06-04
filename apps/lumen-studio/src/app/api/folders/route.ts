import { translate } from '@/i18n/messages';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { createStudioFolder, listStudioFolders } from '@/server/projectFolders';
import { z } from 'zod';

export const runtime = 'nodejs';

export const GET = withApiRouteSpan('GET /api/folders', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const result = await listStudioFolders();
    return okJson(result);
  } catch (error) {
    return routeError(error, locale);
  }
});

const CreateBodySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
  })
  .strict();

export const POST = withApiRouteSpan('POST /api/folders', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const body = CreateBodySchema.parse(await readJson(request));
    const folder = await createStudioFolder(body.name);
    return okJson({ folder }, { status: 201 });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return failJson(translate(locale, 'api.invalidJson'), 400);
    }
    return routeError(error, locale);
  }
});
