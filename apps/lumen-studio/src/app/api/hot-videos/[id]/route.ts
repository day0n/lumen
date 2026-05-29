import { getHotVideo } from '@/server/hotVideos';
import { failJson, okJson, routeError } from '@/server/http';

export const runtime = 'nodejs';

interface HotVideoRouteContext {
  params: Promise<{
    id: string;
  }>;
}

export async function GET(_request: Request, context: HotVideoRouteContext) {
  try {
    const { id } = await context.params;
    const video = await getHotVideo(id);

    if (!video) {
      return failJson('爆款视频不存在', 404);
    }

    return okJson({ video });
  } catch (error) {
    return routeError(error);
  }
}
