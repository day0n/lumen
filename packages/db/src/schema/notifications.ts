import { z } from 'zod';

export const OfficialNotificationStatusSchema = z.enum(['active', 'hidden']);
export type OfficialNotificationStatus = z.infer<typeof OfficialNotificationStatusSchema>;

const OfficialNotificationTranslationSchema = z
  .object({
    title: z.string().trim().min(1).max(140).optional(),
    body: z.string().trim().min(1).max(5000).optional(),
  })
  .strict();

const OfficialNotificationTranslationsSchema = z
  .object({
    en: OfficialNotificationTranslationSchema.optional(),
    zh: OfficialNotificationTranslationSchema.optional(),
  })
  .strict();

export type OfficialNotificationTranslations = z.infer<
  typeof OfficialNotificationTranslationsSchema
>;

export const OfficialNotificationDocumentSchema = z
  .object({
    _id: z.string().min(1),
    title: z.string().trim().min(1).max(140),
    body: z.string().trim().min(1).max(5000),
    translations: OfficialNotificationTranslationsSchema.optional(),
    published_at: z.date(),
    sort_order: z.number().int(),
    status: OfficialNotificationStatusSchema.default('active'),
    created_at: z.date(),
    updated_at: z.date(),
  })
  .strict();
export type OfficialNotificationDocument = z.infer<typeof OfficialNotificationDocumentSchema>;

export const NotificationReadDocumentSchema = z
  .object({
    _id: z.string().min(1),
    user_id: z.string().min(1),
    notification_id: z.string().min(1),
    read_at: z.date(),
    created_at: z.date(),
    updated_at: z.date(),
  })
  .strict();
export type NotificationReadDocument = z.infer<typeof NotificationReadDocumentSchema>;

export const OfficialNotificationRecordSchema = z
  .object({
    id: z.string().min(1),
    title: z.string().min(1),
    body: z.string().min(1),
    publishedAt: z.string().datetime(),
    isRead: z.boolean(),
  })
  .strict();
export type OfficialNotificationRecord = z.infer<typeof OfficialNotificationRecordSchema>;

export const CreateOfficialNotificationInputSchema = z
  .object({
    id: z.string().trim().min(1).max(120).optional(),
    title: z.string().trim().min(1).max(140),
    body: z.string().trim().min(1).max(5000),
    translations: OfficialNotificationTranslationsSchema.optional(),
    publishedAt: z.date().optional(),
    sortOrder: z.number().int().optional(),
    status: OfficialNotificationStatusSchema.optional(),
  })
  .strict();
export type CreateOfficialNotificationInput = z.input<typeof CreateOfficialNotificationInputSchema>;
