import { randomUUID } from 'node:crypto';
import type { Collection, Db } from 'mongodb';

import {
  type LumenCanvas,
  type LumenCanvasNodeData,
  type WorkflowEditSummary,
  normalizeWorkflowCanvas,
  summarizeWorkflowEdit,
} from '@lumen/shared/domain';

import { logger } from '../../../platform/logger.js';
import { getRedis } from '../persistence/redis.js';

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

    const canvas = normalizeWorkflowCanvas(input.canvas);
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

  /**
   * Atomically patch a single node's data fields without rewriting the whole
   * canvas. Required when multiple `run_canvas_node` calls execute in parallel
   * — a read-modify-write of the full canvas would let later writers clobber
   * earlier writers' outputs based on a stale in-memory snapshot. Mongo
   * guarantees single-document updates are atomic, so concurrent patches to
   * different nodes (different positional matches) both apply.
   *
   * Patch values of `undefined` are translated to `$unset` so callers can
   * clear optional fields the same way the in-memory `updateCanvasNodeData`
   * helper did.
   *
   * Returns null if no node with that id was found, so callers can surface a
   * clear error instead of silently no-oping.
   */
  async patchNodeData(input: {
    userId: string;
    projectId: string;
    nodeId: string;
    patch: Partial<LumenCanvasNodeData>;
  }): Promise<WorkflowProject | null> {
    const set: Record<string, unknown> = {};
    const unset: Record<string, ''> = {};
    for (const [key, value] of Object.entries(input.patch)) {
      const path = `canvas.nodes.$.data.${key}`;
      if (value === undefined) {
        unset[path] = '';
      } else {
        set[path] = value;
      }
    }
    set.updated_at = new Date();

    const update: Record<string, unknown> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;

    const doc = await this.projects.findOneAndUpdate(
      {
        _id: input.projectId,
        owner_id: input.userId,
        'canvas.nodes.id': input.nodeId,
        deleted_at: { $exists: false },
      },
      update,
      { returnDocument: 'after' },
    );
    if (!doc) return null;
    await invalidateStudioProjectCache(input.userId, input.projectId);
    return toProject(doc);
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
    canvas: normalizeWorkflowCanvas(doc.canvas ?? { nodes: [], edges: [] }),
    updatedAt: doc.updated_at,
  };
}
