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
  type ProjectFolderSystemKey,
  type UpdateProjectFolderInput,
  UpdateProjectFolderInputSchema,
} from '../schema/projectFolder';

const COLLECTION = 'studio_project_folders';

/** 普通用户文件夹的 sort_order 起点。系统文件夹强制 < 这个值，永远在最上面。 */
const USER_SORT_BASE = 1000;

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
    const sortOrder =
      parsed.sortOrder ?? (parsed.systemKey ? 0 : USER_SORT_BASE + now.getTime());

    const document = ProjectFolderDocumentSchema.parse({
      _id: randomUUID(),
      owner_id: parsed.ownerId,
      name: parsed.name,
      system_key: parsed.systemKey,
      sort_order: sortOrder,
      created_at: now,
      updated_at: now,
    });

    await this.collection().insertOne(document);
    return toRecord(document);
  }

  /**
   * 用户首次访问/触发对应业务时调用：如果同一个 owner 已经有同 system_key 的文件夹
   * （包括软删过的）直接返回；否则插入一条。
   */
  async ensureSystemFolder(
    ownerId: string,
    systemKey: ProjectFolderSystemKey,
    defaultName: string,
  ): Promise<ProjectFolderRecord> {
    const collection = this.collection();
    const existing = await collection.findOne({
      owner_id: ownerId,
      system_key: systemKey,
    });

    if (existing) {
      if (existing.deleted_at) {
        // 用户误删过系统文件夹，悄悄复活；保留 name 不强行覆盖。
        const restored = await collection.findOneAndUpdate(
          { _id: existing._id },
          {
            $unset: { deleted_at: '' },
            $set: { updated_at: new Date() },
          },
          { returnDocument: 'after' },
        );
        if (restored) return toRecord(restored);
      }
      return toRecord(existing);
    }

    return this.create({
      ownerId,
      name: defaultName,
      systemKey,
      sortOrder: 0,
    });
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
        // 系统文件夹不允许重命名 / 改序号
        system_key: { $exists: false },
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
        // 系统文件夹不允许删除
        system_key: { $exists: false },
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
    systemKey: parsed.system_key,
    sortOrder: parsed.sort_order,
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
  });
}
