import { z } from 'zod';

export const UserDocumentSchema = z
  .object({
    _id: z.string().min(1),
    clerk_user_id: z.string().min(1),
    email: z.string().trim().email().optional(),
    first_name: z.string().trim().max(120).optional(),
    last_name: z.string().trim().max(120).optional(),
    full_name: z.string().trim().max(240).optional(),
    image_url: z.string().trim().url().optional(),
    created_at: z.date(),
    updated_at: z.date(),
    last_seen_at: z.date().optional(),
  })
  .strict();
export type UserDocument = z.infer<typeof UserDocumentSchema>;

export const UserRecordSchema = z
  .object({
    id: z.string().min(1),
    clerkUserId: z.string().min(1),
    email: z.string().email().optional(),
    firstName: z.string().optional(),
    lastName: z.string().optional(),
    fullName: z.string().optional(),
    imageUrl: z.string().url().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
    lastSeenAt: z.string().datetime().optional(),
  })
  .strict();
export type UserRecord = z.infer<typeof UserRecordSchema>;

export const UpsertUserInputSchema = z
  .object({
    clerkUserId: z.string().min(1),
    email: z.string().trim().email().optional(),
    firstName: z.string().trim().max(120).optional(),
    lastName: z.string().trim().max(120).optional(),
    fullName: z.string().trim().max(240).optional(),
    imageUrl: z.string().trim().url().optional(),
  })
  .strict();
export type UpsertUserInput = z.infer<typeof UpsertUserInputSchema>;
