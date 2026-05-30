import { randomUUID } from 'node:crypto';
import type { Collection, Db } from 'mongodb';

import {
  type LumenCanvas,
  LumenCanvasSchema,
  type WorkflowEditSummary,
  summarizeWorkflowEdit,
} from '@lumen/shared/domain';

import { getRedis } from '../database/redis.js';
import { logger } from '../observability/logger.js';

interface ProjectDocument {
  _id: string;
  owner_id: string;
  title: string;
  canvas: LumenCanvas;
  deleted_at?: Date;
  updated_at: Date;
}

interface ProjectHistoryDocument {
  _id: string;
  owner_id: string;
  project_id: string;
  title: string;
  action: 'updated';
  canvas: LumenCanvas;
  node_count: number;
  edge_count: number;
  created_at: Date;
}

export interface WorkflowProject {
  id: string;
  ownerId: string;
  title: string;
  canvas: LumenCanvas;
  updatedAt: Date;
}

export interface UpdateWorkflowCanvasResult {
  project: WorkflowProject;
  previousCanvas: LumenCanvas | null;
  summary: WorkflowEditSummary;
}

export class ProjectWorkflowStore {
  private readonly projects: Collection<ProjectDocument>;
  private readonly history: Collection<ProjectHistoryDocument>;

  constructor(db: Db) {
    this.projects = db.collection<ProjectDocument>('studio_projects');
    this.history = db.collection<ProjectHistoryDocument>('studio_project_history');
  }

  async getProject(userId: string, projectId: string): Promise<WorkflowProject | null> {
    const doc = await this.projects.findOne({
      _id: projectId,
      owner_id: userId,
      deleted_at: { $exists: false },
    });
    if (!doc) return null;
    return toProject(doc);
  }

  async updateCanvas(input: {
    userId: string;
    projectId: string;
    canvas: LumenCanvas;
    title?: string;
    recordHistory?: boolean;
  }): Promise<UpdateWorkflowCanvasResult | null> {
    const current = await this.getProject(input.userId, input.projectId);
    if (!current) return null;

    const canvas = LumenCanvasSchema.parse(input.canvas);
    const now = new Date();
    const set: Partial<ProjectDocument> = {
      canvas,
      updated_at: now,
    };
    if (input.title) set.title = input.title;

    const doc = await this.projects.findOneAndUpdate(
      {
        _id: input.projectId,
        owner_id: input.userId,
        deleted_at: { $exists: false },
      },
      { $set: set },
      { returnDocument: 'after' },
    );
    if (!doc) return null;
    await invalidateStudioProjectCache(input.userId, input.projectId);

    if (input.recordHistory !== false) {
      await this.history.insertOne({
        _id: randomUUID(),
        owner_id: input.userId,
        project_id: input.projectId,
        title: doc.title,
        action: 'updated',
        canvas,
        node_count: canvas.nodes.length,
        edge_count: canvas.edges.length,
        created_at: now,
      });
      await this.pruneHistory(input.userId, input.projectId);
    }

    return {
      project: toProject(doc),
      previousCanvas: current.canvas,
      summary: summarizeWorkflowEdit(current.canvas, canvas),
    };
  }

  private async pruneHistory(userId: string, projectId: string): Promise<void> {
    const stale = await this.history
      .find({ owner_id: userId, project_id: projectId }, { projection: { _id: 1 } })
      .sort({ created_at: -1 })
      .skip(3)
      .toArray();
    if (stale.length === 0) return;
    await this.history.deleteMany({ _id: { $in: stale.map((doc) => doc._id) } });
  }
}

async function invalidateStudioProjectCache(userId: string, projectId: string): Promise<void> {
  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.del(`lumen:studio:project:${userId}:${projectId}`);
  } catch (err) {
    logger.warn(
      { err, user_id: userId, project_id: projectId },
      'failed to invalidate project cache',
    );
  }
}

function toProject(doc: ProjectDocument): WorkflowProject {
  return {
    id: doc._id,
    ownerId: doc.owner_id,
    title: doc.title,
    canvas: LumenCanvasSchema.parse(doc.canvas ?? { nodes: [], edges: [] }),
    updatedAt: doc.updated_at,
  };
}
