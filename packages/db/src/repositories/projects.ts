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
} from '../schema/project';

const COLLECTION = 'studio_projects';

export class ProjectRepository {
  constructor(private readonly db: Db) {}

  async ensureIndexes(): Promise<void> {
    const collection = this.collection();
    await collection.createIndex({ owner_id: 1, updated_at: -1 });
    await collection.createIndex({ owner_id: 1, deleted_at: 1 });
    await collection.createIndex({ owner_id: 1, title: 1 });
    await collection.createIndex({ share_id: 1 }, { unique: true, sparse: true });
  }

  async create(input: CreateProjectInput): Promise<ProjectRecord> {
    const parsed = CreateProjectInputSchema.parse(input);
    const now = new Date();
    const document = ProjectDocumentSchema.parse({
      _id: randomUUID(),
      owner_id: parsed.ownerId,
      title: parsed.title,
      description: parsed.description,
      thumbnail: parsed.thumbnail,
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
    if (parsed.canvas !== undefined) set.canvas = ProjectCanvasSchema.parse(parsed.canvas);

    if (parsed.description !== undefined) {
      if (parsed.description === null) unset.description = '';
      else set.description = parsed.description;
    }

    if (parsed.thumbnail !== undefined) {
      if (parsed.thumbnail === null) unset.thumbnail = '';
      else set.thumbnail = parsed.thumbnail;
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
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
