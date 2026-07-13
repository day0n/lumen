import { randomUUID } from 'node:crypto';

import type { Db, Filter } from 'mongodb';

import {
  type CreateProjectInput,
  CreateProjectInputSchema,
  type ListProjectsInput,
  ListProjectsInputSchema,
  type ProjectCanvas,
  ProjectCanvasSchema,
  type ProjectDocument,
  ProjectDocumentSchema,
  type ProjectListRecord,
  ProjectListRecordSchema,
  type ProjectRecord,
  ProjectRecordSchema,
  type UpdateProjectInput,
  UpdateProjectInputSchema,
} from '../schema/project.js';

const COLLECTION = 'studio_projects';

// Hard limit on serialized canvas size. Mongo's per-document limit is 16MB.
// `LumenCanvasNodeDataSchema` uses `.passthrough()` and `settings` is
// `z.record(z.unknown())`, so a misbehaving client could push base64
// thumbnails or raw upload urls into `data.settings` and quickly approach
// 16MB — at which point inserts/updates start failing project-wide.
// 4MB gives ample headroom for a fully-loaded canvas (hundreds of nodes,
// long prompts, R2 URL references) while bounding the worst case well below
// what would break Mongo or knock out auto-save.
const MAX_CANVAS_BYTES = 4 * 1024 * 1024;

export class CanvasTooLargeError extends Error {
  readonly bytes: number;
  readonly limit: number;
  constructor(bytes: number, limit: number) {
    super(`canvas payload too large: ${bytes} bytes exceeds ${limit} byte limit`);
    this.name = 'CanvasTooLargeError';
    this.bytes = bytes;
    this.limit = limit;
  }
}

function assertCanvasWithinLimit(canvas: ProjectCanvas) {
  // Buffer.byteLength is the cheapest accurate UTF-8 size check we have
  // (Mongo BSON encoding is close to but not identical to JSON; this is a
  // tight upper bound that errs on the safe side).
  const size = Buffer.byteLength(JSON.stringify(canvas), 'utf8');
  if (size > MAX_CANVAS_BYTES) {
    throw new CanvasTooLargeError(size, MAX_CANVAS_BYTES);
  }
}

export class ProjectRepository {
  constructor(private readonly db: Db) {}

  async ensureIndexes(): Promise<void> {
    const collection = this.collection();
    await collection.createIndex({ owner_id: 1, updated_at: -1 });
    await collection.createIndex({ owner_id: 1, deleted_at: 1 });
    await collection.createIndex({ owner_id: 1, title: 1 });
    await collection.createIndex({ owner_id: 1, folder_id: 1, updated_at: -1 });
    await collection.createIndex({ share_id: 1 }, { unique: true, sparse: true });
  }

  async create(input: CreateProjectInput): Promise<ProjectRecord> {
    const parsed = CreateProjectInputSchema.parse(input);
    const now = new Date();
    if (parsed.canvas) assertCanvasWithinLimit(parsed.canvas);
    const document = ProjectDocumentSchema.parse({
      _id: randomUUID(),
      owner_id: parsed.ownerId,
      title: parsed.title,
      description: parsed.description,
      thumbnail: parsed.thumbnail,
      folder_id: parsed.folderId,
      status: 'draft',
      canvas: parsed.canvas ?? { nodes: [], edges: [] },
      created_at: now,
      updated_at: now,
    });

    await this.collection().insertOne(document);
    return toProjectRecord(document);
  }

  async list(input: ListProjectsInput): Promise<ProjectListRecord[]> {
    const parsed = ListProjectsInputSchema.parse(input);
    const filter: Filter<ProjectDocument> = {
      owner_id: parsed.ownerId,
      deleted_at: { $exists: false },
    };

    if (parsed.folderId === 'uncategorized') {
      filter.folder_id = { $exists: false };
    } else if (typeof parsed.folderId === 'string') {
      filter.folder_id = parsed.folderId;
    }

    if (parsed.query) {
      filter.title = { $regex: escapeRegExp(parsed.query), $options: 'i' };
    }

    const documents = await this.collection()
      .find(filter, { projection: { canvas: 0 } })
      .sort({ updated_at: -1 })
      .limit(parsed.limit)
      .toArray();

    return documents.map(toProjectListRecord);
  }

  /**
   * 给侧栏算计数用：返回 { folderId -> count }；未分类的项目计入 `'uncategorized'` 这个 key。
   */
  async countByFolder(ownerId: string): Promise<Record<string, number>> {
    const cursor = this.collection().aggregate<{ _id: string | null; count: number }>([
      { $match: { owner_id: ownerId, deleted_at: { $exists: false } } },
      { $group: { _id: { $ifNull: ['$folder_id', null] }, count: { $sum: 1 } } },
    ]);
    const result: Record<string, number> = {};
    for await (const row of cursor) {
      const key = row._id ?? 'uncategorized';
      result[key] = row.count;
    }
    return result;
  }

  /**
   * 文件夹被删除时，把它下面的项目批量挪到"未分类"（unset folder_id）。
   * 仅校验 owner，避免越权改别人的项目。
   */
  async clearFolderForOwner(ownerId: string, folderId: string): Promise<number> {
    const result = await this.collection().updateMany(
      {
        owner_id: ownerId,
        folder_id: folderId,
        deleted_at: { $exists: false },
      },
      {
        $unset: { folder_id: '' },
        $set: { updated_at: new Date() },
      },
    );
    return result.modifiedCount;
  }

  /**
   * 文件夹被销毁式删除时，把它下面所有项目一并软删。
   * 与 `delete(ownerId, projectId)` 同语义：只设 deleted_at，不真删 document，
   * 保留可恢复能力。
   */
  async deleteAllInFolder(ownerId: string, folderId: string): Promise<number> {
    const now = new Date();
    const result = await this.collection().updateMany(
      {
        owner_id: ownerId,
        folder_id: folderId,
        deleted_at: { $exists: false },
      },
      {
        $set: {
          deleted_at: now,
          updated_at: now,
        },
      },
    );
    return result.modifiedCount;
  }

  async get(ownerId: string, projectId: string): Promise<ProjectRecord | null> {
    const document = await this.collection().findOne({
      _id: projectId,
      owner_id: ownerId,
      deleted_at: { $exists: false },
    });

    return document ? toProjectRecord(document) : null;
  }

  async exists(ownerId: string, projectId: string): Promise<boolean> {
    const document = await this.collection().findOne(
      {
        _id: projectId,
        owner_id: ownerId,
        deleted_at: { $exists: false },
      },
      { projection: { _id: 1 } },
    );

    return Boolean(document);
  }

  async getByShareId(shareId: string): Promise<ProjectRecord | null> {
    const document = await this.collection().findOne({
      share_id: shareId,
      deleted_at: { $exists: false },
    });

    return document ? toProjectRecord(document) : null;
  }

  async ensureShareId(ownerId: string, projectId: string): Promise<string | null> {
    const current = await this.collection().findOne({
      _id: projectId,
      owner_id: ownerId,
      deleted_at: { $exists: false },
    });

    if (!current) return null;
    if (current.share_id) return current.share_id;

    const shareId = randomUUID().replaceAll('-', '');
    const document = await this.collection().findOneAndUpdate(
      {
        _id: projectId,
        owner_id: ownerId,
        deleted_at: { $exists: false },
      },
      {
        $set: {
          share_id: shareId,
          updated_at: new Date(),
        },
      },
      { returnDocument: 'after' },
    );

    return document?.share_id ?? null;
  }

  async update(
    ownerId: string,
    projectId: string,
    input: UpdateProjectInput,
  ): Promise<ProjectRecord | null> {
    const parsed = UpdateProjectInputSchema.parse(input);
    const set: Partial<ProjectDocument> = {
      updated_at: new Date(),
    };
    const unset: Record<string, ''> = {};

    if (parsed.title !== undefined) set.title = parsed.title;
    if (parsed.status !== undefined) set.status = parsed.status;
    if (parsed.canvas !== undefined) {
      const canvas = ProjectCanvasSchema.parse(parsed.canvas);
      assertCanvasWithinLimit(canvas);
      set.canvas = canvas;
    }

    if (parsed.description !== undefined) {
      if (parsed.description === null) unset.description = '';
      else set.description = parsed.description;
    }

    if (parsed.thumbnail !== undefined) {
      if (parsed.thumbnail === null) unset.thumbnail = '';
      else set.thumbnail = parsed.thumbnail;
    }

    if (parsed.folderId !== undefined) {
      if (parsed.folderId === null) unset.folder_id = '';
      else set.folder_id = parsed.folderId;
    }

    const document = await this.collection().findOneAndUpdate(
      {
        _id: projectId,
        owner_id: ownerId,
        deleted_at: { $exists: false },
      },
      {
        $set: set,
        ...(Object.keys(unset).length > 0 ? { $unset: unset } : {}),
      },
      { returnDocument: 'after' },
    );

    return document ? toProjectRecord(document) : null;
  }

  async updateCanvas(
    ownerId: string,
    projectId: string,
    canvas: ProjectCanvas,
  ): Promise<ProjectRecord | null> {
    return this.update(ownerId, projectId, { canvas });
  }

  async delete(ownerId: string, projectId: string): Promise<boolean> {
    const result = await this.collection().updateOne(
      {
        _id: projectId,
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
    return this.db.collection<ProjectDocument>(COLLECTION);
  }
}

function toProjectRecord(document: ProjectDocument): ProjectRecord {
  const parsed = ProjectDocumentSchema.parse(document);
  return ProjectRecordSchema.parse({
    id: parsed._id,
    ownerId: parsed.owner_id,
    title: parsed.title,
    description: parsed.description,
    status: parsed.status,
    thumbnail: parsed.thumbnail,
    folderId: parsed.folder_id,
    canvas: parsed.canvas,
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
  });
}

function toProjectListRecord(document: Omit<ProjectDocument, 'canvas'>): ProjectListRecord {
  const parsed = ProjectDocumentSchema.omit({ canvas: true }).parse(document);
  return ProjectListRecordSchema.parse({
    id: parsed._id,
    ownerId: parsed.owner_id,
    title: parsed.title,
    description: parsed.description,
    status: parsed.status,
    thumbnail: parsed.thumbnail,
    folderId: parsed.folder_id,
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
