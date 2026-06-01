import { translate } from '@/i18n/messages';
import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { deleteStudioMaterialAsset } from '@/server/materials';

export const runtime = 'nodejs';

export const DELETE = withApiRouteSpan(
  'DELETE /api/material-assets/:assetId',
  async (request: Request, { params }: { params: Promise<{ assetId: string }> }) => {
    const locale = resolveRequestLocale(request);
    try {
      const { assetId } = await params;
      const deleted = await deleteStudioMaterialAsset(assetId);
      if (!deleted) {
        return failJson(translate(locale, 'api.materialAssetNotFound'), 404);
      }

      return okJson({ deleted: true });
    } catch (error) {
      return routeError(error, locale);
    }
  },
);
