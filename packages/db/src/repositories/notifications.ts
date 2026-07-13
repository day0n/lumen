import { randomUUID } from 'node:crypto';

import type { Db } from 'mongodb';

import {
  type CreateOfficialNotificationInput,
  CreateOfficialNotificationInputSchema,
  type NotificationReadDocument,
  type OfficialNotificationDocument,
  OfficialNotificationDocumentSchema,
  type OfficialNotificationRecord,
  OfficialNotificationRecordSchema,
  type OfficialNotificationTranslations,
} from '../schema/notifications.js';

const OFFICIAL_COLLECTION = 'studio_official_notifications';
const READS_COLLECTION = 'studio_notification_reads';
type ContentLocale = 'en' | 'zh';

export class NotificationRepository {
  constructor(private readonly db: Db) {}

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.officialCollection().createIndex({ status: 1, sort_order: 1, published_at: -1 }),
      this.readsCollection().createIndex({ user_id: 1, notification_id: 1 }, { unique: true }),
      this.readsCollection().createIndex({ user_id: 1, read_at: -1 }),
    ]);
  }

  async ensureDefaultOfficialNotifications(
    inputs: readonly CreateOfficialNotificationInput[],
  ): Promise<void> {
    if (inputs.length === 0) return;

    const now = new Date();
    await Promise.all(
      inputs.map(async (input, index) => {
        const parsed = CreateOfficialNotificationInputSchema.parse(input);
        const id = parsed.id ?? randomUUID();
        await this.officialCollection().updateOne(
          { _id: id },
          {
            $set: {
              title: parsed.title,
              body: parsed.body,
              translations: parsed.translations,
              published_at: parsed.publishedAt ?? now,
              sort_order: parsed.sortOrder ?? index,
              status: parsed.status ?? 'active',
              updated_at: now,
            },
            $setOnInsert: {
              _id: id,
              created_at: now,
            },
          },
          { upsert: true },
        );
      }),
    );
  }

  async listOfficialForUser(
    userId: string,
    limit = 20,
    locale: ContentLocale = 'en',
  ): Promise<OfficialNotificationRecord[]> {
    const documents = await this.officialCollection()
      .find({ status: 'active' })
      .sort({ sort_order: 1, published_at: -1, _id: 1 })
      .limit(limit)
      .toArray();

    const ids = documents.map((document) => document._id);
    const reads =
      ids.length === 0
        ? []
        : await this.readsCollection()
            .find({ user_id: userId, notification_id: { $in: ids } })
            .project<{ notification_id: string }>({ notification_id: 1 })
            .toArray();
    const readIds = new Set(reads.map((read) => read.notification_id));

    return documents.map((document) => toRecord(document, readIds.has(document._id), locale));
  }

  async markOfficialRead(userId: string, notificationId: string): Promise<boolean> {
    const notification = await this.officialCollection().findOne({
      _id: notificationId,
      status: 'active',
    });
    if (!notification) return false;

    const now = new Date();
    await this.readsCollection().updateOne(
      { user_id: userId, notification_id: notificationId },
      {
        $setOnInsert: {
          _id: randomUUID(),
          user_id: userId,
          notification_id: notificationId,
          created_at: now,
        },
        $set: {
          read_at: now,
          updated_at: now,
        },
      },
      { upsert: true },
    );
    return true;
  }

  private officialCollection() {
    return this.db.collection<OfficialNotificationDocument>(OFFICIAL_COLLECTION);
  }

  private readsCollection() {
    return this.db.collection<NotificationReadDocument>(READS_COLLECTION);
  }
}

function toRecord(
  document: OfficialNotificationDocument,
  isRead: boolean,
  locale: ContentLocale,
): OfficialNotificationRecord {
  const parsed = OfficialNotificationDocumentSchema.parse(document);
  const translation = readTranslation(parsed.translations, locale);
  return OfficialNotificationRecordSchema.parse({
    id: parsed._id,
    title: translation.title ?? parsed.title,
    body: translation.body ?? parsed.body,
    publishedAt: parsed.published_at.toISOString(),
    isRead,
  });
}

function readTranslation(
  translations: OfficialNotificationTranslations | undefined,
  locale: ContentLocale,
) {
  return translations?.[locale] ?? translations?.en ?? {};
}
