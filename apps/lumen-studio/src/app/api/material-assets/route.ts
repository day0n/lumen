import { okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { listStudioMaterialAssets } from '@/server/materials';
import { MaterialAssetKindSchema } from '@lumen/db';

export const runtime = 'nodejs';

export const GET = withApiRouteSpan('GET /api/material-assets', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const url = new URL(request.url);
    const workflowId = url.searchParams.get('workflowId') ?? undefined;
    const kindParam = url.searchParams.get('kind') ?? undefined;
    const limitParam = url.searchParams.get('limit');
    const kind = kindParam ? MaterialAssetKindSchema.parse(kindParam) : undefined;
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const assets = await listStudioMaterialAssets({ workflowId, kind, limit });

    return okJson({ assets });
  } catch (error) {
    return routeError(error, locale);
  }
});
