import { translate } from '@/i18n/messages';
import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { markOfficialNotificationRead } from '@/server/notifications';

export const runtime = 'nodejs';

interface NotificationReadRouteContext {
  params: Promise<{
    notificationId: string;
  }>;
}

export const POST = withApiRouteSpan(
  'POST /api/notifications/official/:notificationId/read',
  async (request: Request, context: NotificationReadRouteContext) => {
    const locale = resolveRequestLocale(request);
    try {
      const { notificationId } = await context.params;
      const updated = await markOfficialNotificationRead(notificationId);

      if (!updated) {
        return failJson(translate(locale, 'api.notificationNotFound'), 404);
      }

      return okJson({ read: true });
    } catch (error) {
      return routeError(error, locale);
    }
  },
);
