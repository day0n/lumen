import { randomUUID } from 'node:crypto';

import type { Db } from 'mongodb';

import {
  type ListProjectHistoryInput,
  ListProjectHistoryInputSchema,
  type ProjectHistoryDocument,
  ProjectHistoryDocumentSchema,
  type ProjectHistoryRecord,
  ProjectHistoryRecordSchema,
  type ProjectHistorySummaryRecord,
  ProjectHistorySummaryRecordSchema,
  type RecordProjectHistoryInput,
  RecordProjectHistoryInputSchema,
} from '../schema/projectHistory.js';

const COLLECTION = 'studio_project_history';
const MAX_HISTORY_PER_PROJECT = 3;
const MIN_UPDATED_HISTORY_INTERVAL_MS = 30_000;

export class ProjectHistoryRepository {
  constructor(private readonly db: Db) {}

  async ensureIndexes(): Promise<void> {
    const collection = this.collection();
    await collection.createIndex({ owner_id: 1, project_id: 1, created_at: -1 });
  }

  async recordSnapshot(input: RecordProjectHistoryInput): Promise<ProjectHistoryRecord> {
    const parsed = RecordProjectHistoryInputSchema.parse(input);
    const now = new Date();
    const collection = this.collection();

    if (parsed.action === 'updated') {
      const latest = await collection.findOne(
        {
          owner_id: parsed.ownerId,
          project_id: parsed.projectId,
          action: 'updated',
        },
        { sort: { created_at: -1 } },
      );

      if (latest && now.getTime() - latest.created_at.getTime() < MIN_UPDATED_HISTORY_INTERVAL_MS) {
        const document = ProjectHistoryDocumentSchema.parse({
          ...latest,
          title: parsed.title,
          canvas: parsed.canvas,
          node_count: parsed.canvas.nodes.length,
          edge_count: parsed.canvas.edges.length,
          created_at: now,
        });

        await collection.updateOne(
          { _id: latest._id },
          {
            $set: {
              title: document.title,
              canvas: document.canvas,
              node_count: document.node_count,
              edge_count: document.edge_count,
              created_at: document.created_at,
            },
          },
        );

        return toProjectHistoryRecord(document);
      }
    }

    const document = ProjectHistoryDocumentSchema.parse({
      _id: randomUUID(),
      owner_id: parsed.ownerId,
      project_id: parsed.projectId,
      title: parsed.title,
      action: parsed.action,
      canvas: parsed.canvas,
      node_count: parsed.canvas.nodes.length,
      edge_count: parsed.canvas.edges.length,
      created_at: now,
    });

    await collection.insertOne(document);
    await this.prune(parsed.ownerId, parsed.projectId);
    return toProjectHistoryRecord(document);
  }

  async listLatest(input: ListProjectHistoryInput): Promise<ProjectHistoryRecord[]> {
    const parsed = ListProjectHistoryInputSchema.parse(input);
    const documents = await this.collection()
      .find({
        owner_id: parsed.ownerId,
        project_id: parsed.projectId,
      })
      .sort({ created_at: -1 })
      .limit(parsed.limit)
      .toArray();

    return documents.map(toProjectHistoryRecord);
  }

  async listLatestSummaries(
    input: ListProjectHistoryInput,
  ): Promise<ProjectHistorySummaryRecord[]> {
    const parsed = ListProjectHistoryInputSchema.parse(input);
    const documents = await this.collection()
      .find(
        {
          owner_id: parsed.ownerId,
          project_id: parsed.projectId,
        },
        { projection: { canvas: 0 } },
      )
      .sort({ created_at: -1 })
      .limit(parsed.limit)
      .toArray();

    return documents.map(toProjectHistorySummaryRecord);
  }

  async get(
    ownerId: string,
    projectId: string,
    historyId: string,
  ): Promise<ProjectHistoryRecord | null> {
    const document = await this.collection().findOne({
      _id: historyId,
      owner_id: ownerId,
      project_id: projectId,
    });

    return document ? toProjectHistoryRecord(document) : null;
  }

  private async prune(ownerId: string, projectId: string) {
    const stale = await this.collection()
      .find(
        {
          owner_id: ownerId,
          project_id: projectId,
        },
        { projection: { _id: 1 } },
      )
      .sort({ created_at: -1 })
      .skip(MAX_HISTORY_PER_PROJECT)
      .toArray();

    if (stale.length === 0) return;

    await this.collection().deleteMany({
      _id: { $in: stale.map((document) => document._id) },
    });
  }

  private collection() {
    return this.db.collection<ProjectHistoryDocument>(COLLECTION);
  }
}

function toProjectHistoryRecord(document: ProjectHistoryDocument): ProjectHistoryRecord {
  const parsed = ProjectHistoryDocumentSchema.parse(document);
  return ProjectHistoryRecordSchema.parse({
    id: parsed._id,
    ownerId: parsed.owner_id,
    projectId: parsed.project_id,
    title: parsed.title,
    action: parsed.action,
    canvas: parsed.canvas,
    nodeCount: parsed.node_count,
    edgeCount: parsed.edge_count,
    createdAt: parsed.created_at.toISOString(),
  });
}

function toProjectHistorySummaryRecord(
  document: Omit<ProjectHistoryDocument, 'canvas'>,
): ProjectHistorySummaryRecord {
  const parsed = ProjectHistoryDocumentSchema.omit({ canvas: true }).parse(document);
  return ProjectHistorySummaryRecordSchema.parse({
    id: parsed._id,
    ownerId: parsed.owner_id,
    projectId: parsed.project_id,
    title: parsed.title,
    action: parsed.action,
    nodeCount: parsed.node_count,
    edgeCount: parsed.edge_count,
    createdAt: parsed.created_at.toISOString(),
  });
}
