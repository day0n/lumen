import { randomUUID } from 'node:crypto';

import type { Db, Filter, UpdateFilter } from 'mongodb';

import {
  type CreateRemakeJobInput,
  CreateRemakeJobInputSchema,
  REMAKE_JOBS_COLLECTION,
  REMAKE_TASKS_COLLECTION,
  type RemakeJobDocument,
  RemakeJobDocumentSchema,
  type RemakeJobOutputs,
  type RemakeJobRecord,
  RemakeJobRecordSchema,
  type RemakeJobSceneOutput,
  type RemakeStageName,
  type RemakeStageState,
  type RemakeTaskDocument,
  RemakeTaskDocumentSchema,
  type RemakeTaskHandler,
  type RemakeTaskInput,
  type RemakeTaskRecord,
  RemakeTaskRecordSchema,
  type RemakeTaskStatus,
  type UpdateRemakeJobInput,
  UpdateRemakeJobInputSchema,
} from '../schema/remakeJob';

const DEFAULT_LIST_LIMIT = 50;

const STAGE_NAMES: RemakeStageName[] = [
  'breakdown',
  'script',
  'lock',
  'storyboard',
  'video',
  'final',
];

export class RemakeJobRepository {
  constructor(private readonly db: Db) {}

  async ensureIndexes(): Promise<void> {
    await Promise.all([
      this.jobs().createIndex({ owner_id: 1, updated_at: -1 }),
      this.jobs().createIndex({ owner_id: 1, status: 1, updated_at: -1 }),
      this.jobs().createIndex({ video_id: 1 }),
      this.tasks().createIndex({ job_id: 1, stage: 1 }),
      this.tasks().createIndex({ job_id: 1, slice_key: 1 }, { unique: true }),
      this.tasks().createIndex({ status: 1, updated_at: -1 }),
    ]);
  }

  // ============================================================
  // Job CRUD
  // ============================================================

  async createJob(input: CreateRemakeJobInput): Promise<RemakeJobRecord> {
    const parsed = CreateRemakeJobInputSchema.parse(input);
    const now = new Date();
    const document = RemakeJobDocumentSchema.parse({
      _id: randomUUID(),
      owner_id: parsed.ownerId,
      video_id: parsed.videoId,
      reference: parsed.reference,
      settings: parsed.settings,
      plan: parsed.plan,
      breakdown: parsed.breakdown,
      product_image_urls: parsed.productImageUrls,
      creator_image_urls: parsed.creatorImageUrls,
      environment_image_urls: parsed.environmentImageUrls,
      user_prompt: parsed.userPrompt,
      stages: buildInitialStages(),
      outputs: { scenes: [] },
      status: 'active',
      created_at: now,
      updated_at: now,
    });
    await this.jobs().insertOne(document);
    return toJobRecord(document);
  }

  async getJob(jobId: string, ownerId: string): Promise<RemakeJobRecord | null> {
    const document = await this.jobs().findOne({ _id: jobId, owner_id: ownerId });
    return document ? toJobRecord(document) : null;
  }

  async listJobsForOwner(
    ownerId: string,
    options: { limit?: number; status?: 'active' | 'archived' } = {},
  ): Promise<RemakeJobRecord[]> {
    const filter: Filter<RemakeJobDocument> = { owner_id: ownerId };
    if (options.status) filter.status = options.status;
    const documents = await this.jobs()
      .find(filter)
      .sort({ updated_at: -1 })
      .limit(options.limit ?? DEFAULT_LIST_LIMIT)
      .toArray();
    return documents.map(toJobRecord);
  }

  async updateJob(
    jobId: string,
    ownerId: string,
    patch: UpdateRemakeJobInput,
  ): Promise<RemakeJobRecord | null> {
    const parsed = UpdateRemakeJobInputSchema.parse(patch);
    const set: Record<string, unknown> = { updated_at: new Date() };
    if (parsed.reference !== undefined) set.reference = parsed.reference;
    if (parsed.plan !== undefined) set.plan = parsed.plan;
    if (parsed.breakdown !== undefined) set.breakdown = parsed.breakdown;
    if (parsed.settings !== undefined) set.settings = parsed.settings;
    if (parsed.productImageUrls !== undefined) set.product_image_urls = parsed.productImageUrls;
    if (parsed.creatorImageUrls !== undefined) set.creator_image_urls = parsed.creatorImageUrls;
    if (parsed.environmentImageUrls !== undefined) {
      set.environment_image_urls = parsed.environmentImageUrls;
    }
    if (parsed.userPrompt !== undefined) set.user_prompt = parsed.userPrompt;
    if (parsed.gate1ConfirmedAt !== undefined) set.gate1_confirmed_at = parsed.gate1ConfirmedAt;
    if (parsed.gate2ConfirmedAt !== undefined) set.gate2_confirmed_at = parsed.gate2ConfirmedAt;
    if (parsed.status !== undefined) set.status = parsed.status;

    const update: UpdateFilter<RemakeJobDocument> = { $set: set };

    if (parsed.error === null) {
      update.$unset = { ...(update.$unset ?? {}), error: '' };
    } else if (parsed.error !== undefined) {
      set.error = parsed.error;
    }

    if (parsed.stagePatch) {
      set[`stages.${parsed.stagePatch.name}`] = parsed.stagePatch.state;
    }

    if (parsed.outputsPatch) {
      const outputs = parsed.outputsPatch;
      if (outputs.creatorLockUrl !== undefined) {
        set['outputs.creatorLockUrl'] = outputs.creatorLockUrl;
      }
      if (outputs.productLockUrl !== undefined) {
        set['outputs.productLockUrl'] = outputs.productLockUrl;
      }
      if (outputs.environmentLocks !== undefined) {
        set['outputs.environmentLocks'] = outputs.environmentLocks;
      }
      if (outputs.bgmUrl !== undefined) set['outputs.bgmUrl'] = outputs.bgmUrl;
      if (outputs.finalUrl !== undefined) set['outputs.finalUrl'] = outputs.finalUrl;
      // scenes 数组：调用方传完整新数组（jobs 层在调用前合并旧值）
      if (outputs.scenes !== undefined) set['outputs.scenes'] = outputs.scenes;
    }

    const result = await this.jobs().findOneAndUpdate({ _id: jobId, owner_id: ownerId }, update, {
      returnDocument: 'after',
    });
    return result ? toJobRecord(result) : null;
  }

  /**
   * 原子地把 scene N 的某一字段（image/video/voice/mix Url）写进 outputs.scenes 数组。
   * 找不到对应 sceneIndex 就 push 一个新条目；找得到就 patch。
   */
  async patchSceneOutput(
    jobId: string,
    ownerId: string,
    sceneIndex: number,
    patch: Partial<Omit<RemakeJobSceneOutput, 'sceneIndex'>>,
  ): Promise<RemakeJobRecord | null> {
    const job = await this.jobs().findOne({ _id: jobId, owner_id: ownerId });
    if (!job) return null;
    const scenes = [...(job.outputs?.scenes ?? [])];
    const existingIndex = scenes.findIndex((scene) => scene.sceneIndex === sceneIndex);
    if (existingIndex >= 0) {
      scenes[existingIndex] = { ...scenes[existingIndex], ...patch, sceneIndex };
    } else {
      scenes.push({ sceneIndex, ...patch });
    }
    scenes.sort((a, b) => a.sceneIndex - b.sceneIndex);
    const result = await this.jobs().findOneAndUpdate(
      { _id: jobId, owner_id: ownerId },
      { $set: { 'outputs.scenes': scenes, updated_at: new Date() } },
      { returnDocument: 'after' },
    );
    return result ? toJobRecord(result) : null;
  }

  async patchEnvironmentOutput(
    jobId: string,
    ownerId: string,
    environmentIndex: number,
    imageUrl: string,
  ): Promise<RemakeJobRecord | null> {
    const job = await this.jobs().findOne({ _id: jobId, owner_id: ownerId });
    if (!job) return null;
    const environmentLocks = [...(job.outputs?.environmentLocks ?? [])];
    const existingIndex = environmentLocks.findIndex(
      (item) => item.environmentIndex === environmentIndex,
    );
    if (existingIndex >= 0) {
      environmentLocks[existingIndex] = { environmentIndex, imageUrl };
    } else {
      environmentLocks.push({ environmentIndex, imageUrl });
    }
    environmentLocks.sort((a, b) => a.environmentIndex - b.environmentIndex);
    const result = await this.jobs().findOneAndUpdate(
      { _id: jobId, owner_id: ownerId },
      { $set: { 'outputs.environmentLocks': environmentLocks, updated_at: new Date() } },
      { returnDocument: 'after' },
    );
    return result ? toJobRecord(result) : null;
  }

  // ============================================================
  // Task CRUD
  // ============================================================

  async createTasks(
    inputs: Array<{
      jobId: string;
      stage: RemakeStageName;
      sliceKey: string;
      handler: RemakeTaskHandler;
      input: RemakeTaskInput;
      settings?: Record<string, unknown>;
    }>,
  ): Promise<RemakeTaskRecord[]> {
    if (inputs.length === 0) return [];
    const now = new Date();
    const documents = inputs.map((item) =>
      RemakeTaskDocumentSchema.parse({
        _id: randomUUID(),
        job_id: item.jobId,
        stage: item.stage,
        slice_key: item.sliceKey,
        handler: item.handler,
        input: item.input,
        settings: item.settings ?? {},
        status: 'queued',
        progress: 0,
        created_at: now,
        updated_at: now,
      }),
    );
    // upsert by (job_id, slice_key) — replan / retry 会覆盖同 slice 的旧 task
    const records: RemakeTaskRecord[] = [];
    for (const doc of documents) {
      const result = await this.tasks().findOneAndUpdate(
        { job_id: doc.job_id, slice_key: doc.slice_key },
        {
          $set: {
            stage: doc.stage,
            handler: doc.handler,
            input: doc.input,
            settings: doc.settings,
            status: 'queued',
            progress: 0,
            updated_at: now,
          },
          $unset: { output_url: '', output_kind: '', error: '', started_at: '', settled_at: '' },
          $setOnInsert: {
            _id: doc._id,
            job_id: doc.job_id,
            slice_key: doc.slice_key,
            created_at: now,
          },
        },
        { upsert: true, returnDocument: 'after' },
      );
      if (result) records.push(toTaskRecord(result));
    }
    return records;
  }

  async listTasksByJob(jobId: string): Promise<RemakeTaskRecord[]> {
    const documents = await this.tasks().find({ job_id: jobId }).sort({ created_at: 1 }).toArray();
    return documents.map(toTaskRecord);
  }

  async getTask(taskId: string): Promise<RemakeTaskRecord | null> {
    const document = await this.tasks().findOne({ _id: taskId });
    return document ? toTaskRecord(document) : null;
  }

  async patchTaskStatus(
    taskId: string,
    patch: {
      status: RemakeTaskStatus;
      outputUrl?: string;
      outputKind?: 'image' | 'video' | 'audio' | 'text';
      progress?: number;
      error?: string | null;
      streamMessageId?: string;
    },
  ): Promise<RemakeTaskRecord | null> {
    const now = new Date();
    const set: Record<string, unknown> = {
      status: patch.status,
      updated_at: now,
    };
    if (patch.progress !== undefined) set.progress = patch.progress;
    if (patch.outputUrl !== undefined) set.output_url = patch.outputUrl;
    if (patch.outputKind !== undefined) set.output_kind = patch.outputKind;
    if (patch.streamMessageId !== undefined) set.stream_message_id = patch.streamMessageId;

    const update: UpdateFilter<RemakeTaskDocument> = { $set: set };
    if (patch.error === null) {
      update.$unset = { ...(update.$unset ?? {}), error: '' };
    } else if (patch.error !== undefined) {
      set.error = patch.error;
    }

    if (patch.status === 'running') {
      // 第一次进 running 才记录 started_at；mongo 没有"only on first"原语，简单做：
      // 在 jobs.ts 那层判断 prev.status 来决定是否调这个分支带 startedAt（这里就不重置）。
      set.started_at = now;
    }
    if (patch.status === 'success' || patch.status === 'error' || patch.status === 'cancelled') {
      set.settled_at = now;
    }

    const result = await this.tasks().findOneAndUpdate({ _id: taskId }, update, {
      returnDocument: 'after',
    });
    return result ? toTaskRecord(result) : null;
  }

  async cancelTasksByStages(jobId: string, stages: RemakeStageName[]): Promise<number> {
    if (stages.length === 0) return 0;
    const result = await this.tasks().updateMany(
      {
        job_id: jobId,
        stage: { $in: stages },
        status: { $in: ['queued', 'running'] },
      },
      {
        $set: {
          status: 'cancelled',
          settled_at: new Date(),
          updated_at: new Date(),
        },
      },
    );
    return result.modifiedCount;
  }

  /** 删除某些 stage 下所有 task —— replan 时配合 outputs 清理一起用。 */
  async deleteTasksByStages(jobId: string, stages: RemakeStageName[]): Promise<number> {
    if (stages.length === 0) return 0;
    const result = await this.tasks().deleteMany({ job_id: jobId, stage: { $in: stages } });
    return result.deletedCount;
  }

  // ============================================================
  // 内部 collection getter
  // ============================================================

  private jobs() {
    return this.db.collection<RemakeJobDocument>(REMAKE_JOBS_COLLECTION);
  }

  private tasks() {
    return this.db.collection<RemakeTaskDocument>(REMAKE_TASKS_COLLECTION);
  }
}

function buildInitialStages(): RemakeJobDocument['stages'] {
  const locked: RemakeStageState = { status: 'locked' };
  return {
    breakdown: { status: 'success', settledAt: new Date() }, // 拆解在 job 创建前已完成
    script: { status: 'ready' }, // 用户进入页面就能看脚本
    lock: locked, // 等 gate1 确认
    storyboard: locked,
    video: locked,
    final: locked,
  };
}

function toJobRecord(document: RemakeJobDocument): RemakeJobRecord {
  const parsed = RemakeJobDocumentSchema.parse(document);
  return RemakeJobRecordSchema.parse({
    id: parsed._id,
    ownerId: parsed.owner_id,
    videoId: parsed.video_id,
    reference: parsed.reference,
    settings: parsed.settings,
    plan: parsed.plan,
    breakdown: parsed.breakdown,
    productImageUrls: parsed.product_image_urls,
    creatorImageUrls: parsed.creator_image_urls,
    environmentImageUrls: parsed.environment_image_urls,
    userPrompt: parsed.user_prompt,
    stages: parsed.stages,
    gate1ConfirmedAt: parsed.gate1_confirmed_at?.toISOString(),
    gate2ConfirmedAt: parsed.gate2_confirmed_at?.toISOString(),
    outputs: parsed.outputs,
    status: parsed.status,
    error: parsed.error,
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
  });
}

function toTaskRecord(document: RemakeTaskDocument): RemakeTaskRecord {
  const parsed = RemakeTaskDocumentSchema.parse(document);
  return RemakeTaskRecordSchema.parse({
    id: parsed._id,
    jobId: parsed.job_id,
    stage: parsed.stage,
    sliceKey: parsed.slice_key,
    handler: parsed.handler,
    status: parsed.status,
    outputUrl: parsed.output_url,
    outputKind: parsed.output_kind,
    progress: parsed.progress,
    error: parsed.error,
    startedAt: parsed.started_at?.toISOString(),
    settledAt: parsed.settled_at?.toISOString(),
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
  });
}

export { STAGE_NAMES };
