import { failJson, okJson, routeError } from '@/server/http';
import { markOfficialNotificationRead } from '@/server/notifications';

export const runtime = 'nodejs';

interface NotificationReadRouteContext {
  params: Promise<{
    notificationId: string;
  }>;
}

export async function POST(_request: Request, context: NotificationReadRouteContext) {
  try {
    const { notificationId } = await context.params;
    const updated = await markOfficialNotificationRead(notificationId);

    if (!updated) {
      return failJson('通知不存在', 404);
    }

    return okJson({ read: true });
  } catch (error) {
    return routeError(error);
  }
}
