import { randomUUID } from 'node:crypto';

import type { Db } from 'mongodb';

import {
  type CreateProjectFolderInput,
  CreateProjectFolderInputSchema,
  type ListProjectFoldersInput,
  ListProjectFoldersInputSchema,
  type ProjectFolderDocument,
  ProjectFolderDocumentSchema,
  type ProjectFolderRecord,
  ProjectFolderRecordSchema,
  type UpdateProjectFolderInput,
  UpdateProjectFolderInputSchema,
} from '../schema/projectFolder';

const COLLECTION = 'studio_project_folders';

const USER_SORT_BASE = 1000;
/** 已废弃的系统文件夹 key；列表请求时会顺带清理。 */
const RETIRED_SYSTEM_FOLDER_KEY = 'viral_remix';

export class ProjectFolderRepository {
  constructor(private readonly db: Db) {}

  async ensureIndexes(): Promise<void> {
    const collection = this.collection();
    await collection.createIndex({ owner_id: 1, deleted_at: 1, sort_order: 1, created_at: 1 });
    // 同一个用户下，每个 system_key 只能有一份；deleted_at 不在 unique key 里，
    // 这样软删后再次 ensure 也会复用旧的（用户体验更稳定）。
    await collection.createIndex(
      { owner_id: 1, system_key: 1 },
      { unique: true, sparse: true, name: 'owner_system_key_unique' },
    );
  }

  async list(input: ListProjectFoldersInput): Promise<ProjectFolderRecord[]> {
    const parsed = ListProjectFoldersInputSchema.parse(input);
    const documents = await this.collection()
      .find({
        owner_id: parsed.ownerId,
        deleted_at: { $exists: false },
      })
      .sort({ sort_order: 1, created_at: 1 })
      .toArray();
    return documents.map(toRecord);
  }

  async create(input: CreateProjectFolderInput): Promise<ProjectFolderRecord> {
    const parsed = CreateProjectFolderInputSchema.parse(input);
    const now = new Date();
    const sortOrder = parsed.sortOrder ?? USER_SORT_BASE + now.getTime();

    const document = ProjectFolderDocumentSchema.parse({
      _id: randomUUID(),
      owner_id: parsed.ownerId,
      name: parsed.name,
      sort_order: sortOrder,
      created_at: now,
      updated_at: now,
    });

    await this.collection().insertOne(document);
    return toRecord(document);
  }

  /**
   * 软删已废弃的系统文件夹，并返回被清理的 folder id 列表（供项目挪回未分类）。
   */
  async retireLegacySystemFolders(ownerId: string): Promise<string[]> {
    const collection = this.collection();
    const legacy = await collection
      .find({
        owner_id: ownerId,
        system_key: RETIRED_SYSTEM_FOLDER_KEY,
        deleted_at: { $exists: false },
      })
      .project({ _id: 1 })
      .toArray();

    if (legacy.length === 0) return [];

    const now = new Date();
    const folderIds = legacy.map((row) => row._id);
    await collection.updateMany(
      { _id: { $in: folderIds }, owner_id: ownerId },
      {
        $set: {
          deleted_at: now,
          updated_at: now,
        },
      },
    );
    return folderIds;
  }

  async get(ownerId: string, folderId: string): Promise<ProjectFolderRecord | null> {
    const document = await this.collection().findOne({
      _id: folderId,
      owner_id: ownerId,
      deleted_at: { $exists: false },
    });
    return document ? toRecord(document) : null;
  }

  async update(
    ownerId: string,
    folderId: string,
    input: UpdateProjectFolderInput,
  ): Promise<ProjectFolderRecord | null> {
    const parsed = UpdateProjectFolderInputSchema.parse(input);
    const set: Partial<ProjectFolderDocument> = {
      updated_at: new Date(),
    };
    if (parsed.name !== undefined) set.name = parsed.name;
    if (parsed.sortOrder !== undefined) set.sort_order = parsed.sortOrder;

    const document = await this.collection().findOneAndUpdate(
      {
        _id: folderId,
        owner_id: ownerId,
        deleted_at: { $exists: false },
      },
      { $set: set },
      { returnDocument: 'after' },
    );

    return document ? toRecord(document) : null;
  }

  async delete(ownerId: string, folderId: string): Promise<boolean> {
    const result = await this.collection().updateOne(
      {
        _id: folderId,
        owner_id: ownerId,
        deleted_at: { $exists: false },
      },
      {
        $set: {
          deleted_at: new Date(),
          updated_at: new Date(),
        },
      },
    );
    return result.modifiedCount > 0;
  }

  private collection() {
    return this.db.collection<ProjectFolderDocument>(COLLECTION);
  }
}

function toRecord(document: ProjectFolderDocument): ProjectFolderRecord {
  const parsed = ProjectFolderDocumentSchema.parse(document);
  return ProjectFolderRecordSchema.parse({
    id: parsed._id,
    ownerId: parsed.owner_id,
    name: parsed.name,
    sortOrder: parsed.sort_order,
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
  });
}
