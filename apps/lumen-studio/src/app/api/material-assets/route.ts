import { okJson, routeError } from '@/server/http';
import { listStudioMaterialAssets } from '@/server/materials';
import { MaterialAssetKindSchema } from '@lumen/db';

export const runtime = 'nodejs';

export async function GET(request: Request) {
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
    return routeError(error);
  }
}
