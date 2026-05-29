import { listHomeFeaturedItems } from '@/server/home';
import { okJson, routeError } from '@/server/http';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const items = await listHomeFeaturedItems();
    return okJson({ items });
  } catch (error) {
    return routeError(error);
  }
}
