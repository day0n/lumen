import { okJson, routeError } from '@/server/http';
import { listOfficialNotifications } from '@/server/notifications';

export const runtime = 'nodejs';

export async function GET() {
  try {
    const result = await listOfficialNotifications();
    return okJson(result);
  } catch (error) {
    return routeError(error);
  }
}
