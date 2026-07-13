import { randomUUID } from 'node:crypto';

import type { Db } from 'mongodb';

import {
  type UpsertUserInput,
  UpsertUserInputSchema,
  type UserDocument,
  UserDocumentSchema,
  type UserRecord,
  UserRecordSchema,
} from '../schema/user.js';

const COLLECTION = 'studio_users';

export class UserRepository {
  constructor(private readonly db: Db) {}

  async ensureIndexes(): Promise<void> {
    const collection = this.collection();
    await collection.createIndex({ clerk_user_id: 1 }, { unique: true });
    await collection.createIndex({ email: 1 }, { sparse: true });
  }

  async upsertFromClerk(input: UpsertUserInput): Promise<UserRecord> {
    const parsed = UpsertUserInputSchema.parse(input);
    const now = new Date();
    const collection = this.collection();

    const setOnInsert: Partial<UserDocument> = {
      _id: randomUUID(),
      clerk_user_id: parsed.clerkUserId,
      created_at: now,
    };

    const set: Partial<UserDocument> = {
      updated_at: now,
      last_seen_at: now,
    };
    if (parsed.email !== undefined) set.email = parsed.email;
    if (parsed.firstName !== undefined) set.first_name = parsed.firstName;
    if (parsed.lastName !== undefined) set.last_name = parsed.lastName;
    if (parsed.fullName !== undefined) set.full_name = parsed.fullName;
    if (parsed.imageUrl !== undefined) set.image_url = parsed.imageUrl;

    const document = await collection.findOneAndUpdate(
      { clerk_user_id: parsed.clerkUserId },
      {
        $set: set,
        $setOnInsert: setOnInsert,
      },
      { upsert: true, returnDocument: 'after' },
    );

    if (!document) {
      throw new Error('Failed to upsert user');
    }

    return toUserRecord(document);
  }

  async getByClerkId(clerkUserId: string): Promise<UserRecord | null> {
    const document = await this.collection().findOne({ clerk_user_id: clerkUserId });
    return document ? toUserRecord(document) : null;
  }

  async getById(userId: string): Promise<UserRecord | null> {
    const document = await this.collection().findOne({ _id: userId });
    return document ? toUserRecord(document) : null;
  }

  private collection() {
    return this.db.collection<UserDocument>(COLLECTION);
  }
}

function toUserRecord(document: UserDocument): UserRecord {
  const parsed = UserDocumentSchema.parse(document);
  return UserRecordSchema.parse({
    id: parsed._id,
    clerkUserId: parsed.clerk_user_id,
    email: parsed.email,
    firstName: parsed.first_name,
    lastName: parsed.last_name,
    fullName: parsed.full_name,
    imageUrl: parsed.image_url,
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
    lastSeenAt: parsed.last_seen_at?.toISOString(),
  });
}
