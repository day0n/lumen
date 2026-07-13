import 'server-only';

import { type OfficialNotificationsResult, createNotificationService } from '@lumen/backend';
import type { OfficialNotificationRecord } from '@lumen/db';

import type { Locale } from '@/i18n/routing';
import { requireStudioUser } from './auth';
import { getNotificationRepository } from './db';
import { traceStudioStep } from './telemetry';

export type OfficialNotificationsResponse = OfficialNotificationsResult<OfficialNotificationRecord>;

const notificationService = createNotificationService<OfficialNotificationRecord>({
  getRepository: getNotificationRepository,
  trace: traceStudioStep,
  tracePrefix: 'studio',
});

export async function listOfficialNotifications(
  locale: Locale = 'en',
): Promise<OfficialNotificationsResponse> {
  const user = await traceStudioStep('studio.auth.require_user', 'auth', requireStudioUser);
  return notificationService.listOfficial(user.id, locale);
}

export async function markOfficialNotificationRead(notificationId: string): Promise<boolean> {
  const user = await traceStudioStep('studio.auth.require_user', 'auth', requireStudioUser);
  return notificationService.markOfficialRead(user.id, notificationId);
}
