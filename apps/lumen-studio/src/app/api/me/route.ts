import { okJson, routeError } from '@/server/http';
import { getCurrentUser } from '@/server/me';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const result = await getCurrentUser();
    return okJson(result);
  } catch (error) {
    return routeError(error);
  }
}
