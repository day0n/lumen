import { translate } from '@/i18n/messages';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { deleteStudioFolder, updateStudioFolder } from '@/server/projectFolders';
import { UpdateProjectFolderInputSchema } from '@lumen/db';

export const runtime = 'nodejs';

interface FolderRouteContext {
  params: Promise<{ folderId: string }>;
}

export const PATCH = withApiRouteSpan(
  'PATCH /api/folders/:folderId',
  async (request: Request, context: FolderRouteContext) => {
    const locale = resolveRequestLocale(request);
    try {
      const { folderId } = await context.params;
      const body = await readJson(request);
      const input = UpdateProjectFolderInputSchema.parse(body);
      const folder = await updateStudioFolder(folderId, input);
      if (!folder) {
        return failJson(
          locale === 'zh' ? '文件夹不存在或不可修改' : 'Folder not found or read-only',
          404,
        );
      }
      return okJson({ folder });
    } catch (error) {
      if (error instanceof SyntaxError) {
        return failJson(translate(locale, 'api.invalidJson'), 400);
      }
      return routeError(error, locale);
    }
  },
);

export const DELETE = withApiRouteSpan(
  'DELETE /api/folders/:folderId',
  async (request: Request, context: FolderRouteContext) => {
    const locale = resolveRequestLocale(request);
    try {
      const { folderId } = await context.params;
      const deleted = await deleteStudioFolder(folderId);
      if (!deleted) {
        return failJson(
          locale === 'zh' ? '文件夹不存在或不可删除' : 'Folder not found or read-only',
          404,
        );
      }
      return okJson({ deleted: true });
    } catch (error) {
      return routeError(error, locale);
    }
  },
);
