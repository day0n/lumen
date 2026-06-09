import { randomUUID } from 'node:crypto';

import type { AnyBulkWriteOperation, Db, Document, Filter, UpdateFilter } from 'mongodb';

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
   * 条件式更新单个 stage 状态，避免并发 task:done 事件互相覆盖。
   *
   * 背景：两个 task 几乎同时到 success 时，事件 A、B 各自执行
   * "listTasks → derive → write"。事件 A 在 B 之前读 listTasks，看到 B=running，
   * 派生出 stage=running；B 之后读，看到 B=success，派生出 stage=success。
   * 写入顺序不保证 → 可能出现 B 先写 success，A 后写 running，stage 永久卡 running。
   *
   * 修法：如果要写的新状态是非终态（locked/ready/running），加 filter 拒绝覆盖
   * 已经处于终态（success/error/cancelled）的 stage。终态写入则允许覆盖任何状态
   * （task 失败后重跑成功的合理路径）。
   */
  async patchStageGuarded(
    jobId: string,
    ownerId: string,
    stageName: RemakeStageName,
    state: RemakeStageState,
  ): Promise<boolean> {
    const TERMINAL: RemakeStageState['status'][] = ['success', 'error', 'cancelled'];
    const writingTerminal = TERMINAL.includes(state.status);

    const filter: Filter<RemakeJobDocument> = { _id: jobId, owner_id: ownerId };
    if (!writingTerminal) {
      // 不允许把 stage 从终态拉回非终态。
      filter[`stages.${stageName}.status`] = { $nin: TERMINAL };
    }

    const result = await this.jobs().updateOne(filter, {
      $set: {
        [`stages.${stageName}`]: state,
        updated_at: new Date(),
      },
    });
    return result.matchedCount > 0;
  }

  /**
   * 更新 plan.scenes 里某一场的可编辑字段（口播 / 字幕 / 动作 / 分镜 prompt / 视频 prompt 覆盖）。
   * sceneIndex 为 plan.scenes[].index（从 1 起）。
   *
   * 之前的实现是 findOne → 改 nextPlan → `$set: { plan: nextPlan }`。两个 scene
   * 并发编辑时（UI 批量回写 / storyboard 重生成与用户编辑碰撞），后写者用旧快照
   * 整体覆盖 plan，**对方的 scene 编辑被静默丢失**。
   *
   * 修法：
   * - 场内字段（action/dialogue/voiceLine）走位置数组操作符 + arrayFilters，
   *   只动 plan.scenes.$[s].<field>，不同 sceneIndex 互不冲突。
   * - 稀疏 prompt override 数组的更新仍保留 read-modify-write，但只 $set
   *   `plan.sceneImagePrompts`/`plan.sceneVideoPrompts` 这两个具体路径，
   *   不再覆盖整个 `plan`。同 prompt 数组的并发编辑是用户难触发的边角场景，
   *   不同 prompt 数组、不同 scene 字段都不会再互相覆盖。
   */
  async patchScenePlan(
    jobId: string,
    ownerId: string,
    sceneIndex: number,
    patch: {
      action?: string;
      dialogue?: string;
      voiceLine?: string;
      /** 非 null = 写入覆盖；null / 空串 = 清除覆盖，回退到自动生成。 */
      imagePrompt?: string | null;
      /** 非 null = 写入覆盖；null / 空串 = 清除覆盖，回退到自动生成。 */
      videoPrompt?: string | null;
    },
  ): Promise<RemakeJobRecord | null> {
    const job = await this.jobs().findOne({ _id: jobId, owner_id: ownerId });
    if (!job?.plan?.scenes?.length) return null;
    const idx = job.plan.scenes.findIndex((scene) => scene.index === sceneIndex);
    if (idx < 0) return null;

    const sceneCount = job.plan.scenes.length;
    const touchesGenerationInput =
      patch.action !== undefined || patch.dialogue !== undefined || patch.voiceLine !== undefined;

    const nextImagePrompts = computeSparsePromptUpdate(
      job.plan.sceneImagePrompts,
      idx,
      sceneCount,
      patch.imagePrompt,
      touchesGenerationInput,
    );
    const nextVideoPrompts = computeSparsePromptUpdate(
      job.plan.sceneVideoPrompts,
      idx,
      sceneCount,
      patch.videoPrompt,
      touchesGenerationInput,
    );

    const set: Record<string, unknown> = { updated_at: new Date() };
    if (patch.action !== undefined) set['plan.scenes.$[s].action'] = patch.action;
    if (patch.dialogue !== undefined) set['plan.scenes.$[s].dialogue'] = patch.dialogue;
    if (patch.voiceLine !== undefined) set['plan.scenes.$[s].voiceLine'] = patch.voiceLine;
    const unset: Record<string, ''> = {};
    if (nextImagePrompts.kind === 'set') set['plan.sceneImagePrompts'] = nextImagePrompts.value;
    else if (nextImagePrompts.kind === 'unset') unset['plan.sceneImagePrompts'] = '';
    if (nextVideoPrompts.kind === 'set') set['plan.sceneVideoPrompts'] = nextVideoPrompts.value;
    else if (nextVideoPrompts.kind === 'unset') unset['plan.sceneVideoPrompts'] = '';

    const update: UpdateFilter<RemakeJobDocument> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;

    const useArrayFilter =
      patch.action !== undefined || patch.dialogue !== undefined || patch.voiceLine !== undefined;

    const result = await this.jobs().findOneAndUpdate({ _id: jobId, owner_id: ownerId }, update, {
      returnDocument: 'after',
      ...(useArrayFilter ? { arrayFilters: [{ 's.index': sceneIndex }] } : {}),
    });
    return result ? toJobRecord(result) : null;
  }

  /**
   * 更新 plan 上的"全局 prompt 覆盖"字段：
   * - creatorPrompt / productPrompt / bgmPrompt（顶层字符串）
   * - environmentPrompt（按 environment.index 写到 plan.environments[i].prompt）
   *
   * 任何字段传 null = 清除该 override；undefined = 不动；string = 写入。
   */
  async patchPlanPrompts(
    jobId: string,
    ownerId: string,
    patch: {
      creatorPrompt?: string | null;
      productPrompt?: string | null;
      bgmPrompt?: string | null;
      environmentPrompts?: Array<{ environmentIndex: number; prompt: string | null }>;
    },
  ): Promise<RemakeJobRecord | null> {
    // For top-level prompt strings we use scoped paths (`plan.creatorPrompt`)
    // so concurrent writes to different prompts no longer overwrite the whole
    // `plan` document. environmentPrompts still needs an array snapshot
    // because we patch by environment.index, but again we $set only
    // `plan.environments`, not the entire `plan`.
    const set: Record<string, unknown> = { updated_at: new Date() };
    const unset: Record<string, ''> = {};

    const applyTop = (
      key: 'creatorPrompt' | 'productPrompt' | 'bgmPrompt',
      value: string | null | undefined,
    ): void => {
      if (value === undefined) return;
      const trimmed = value?.trim() ?? '';
      if (trimmed) set[`plan.${key}`] = trimmed;
      else unset[`plan.${key}`] = '';
    };
    applyTop('creatorPrompt', patch.creatorPrompt);
    applyTop('productPrompt', patch.productPrompt);
    applyTop('bgmPrompt', patch.bgmPrompt);

    if (patch.environmentPrompts?.length) {
      const job = await this.jobs().findOne({ _id: jobId, owner_id: ownerId });
      if (!job) return null;
      const environments = [...(job.plan.environments ?? [])];
      for (const entry of patch.environmentPrompts) {
        const idx = environments.findIndex((env) => env.index === entry.environmentIndex);
        if (idx < 0) continue;
        const trimmed = entry.prompt?.trim() ?? '';
        const next = { ...environments[idx]! };
        if (trimmed) next.prompt = trimmed;
        else next.prompt = undefined;
        environments[idx] = next;
      }
      set['plan.environments'] = environments;
    } else if (Object.keys(set).length === 1 && Object.keys(unset).length === 0) {
      // Nothing to write at all (only updated_at).
      const existing = await this.jobs().findOne({ _id: jobId, owner_id: ownerId });
      return existing ? toJobRecord(existing) : null;
    }

    const update: UpdateFilter<RemakeJobDocument> = { $set: set };
    if (Object.keys(unset).length > 0) update.$unset = unset;

    const result = await this.jobs().findOneAndUpdate({ _id: jobId, owner_id: ownerId }, update, {
      returnDocument: 'after',
    });
    return result ? toJobRecord(result) : null;
  }

  /**
   * 原子地把 scene N 的某一字段（image/video/voice/mix Url）写进 outputs.scenes 数组。
   *
   * 用 aggregation-pipeline update 让 mongo 在服务端单文档原子事务里完成
   * "存在则 patch，不存在则 push"。之前的实现是 Node 端 read-modify-write：
   *   findOne → mutate scenes 数组 → $set 'outputs.scenes' 为整个新数组
   * 两个 scene 几乎同时回写时，后写者拿到的是落后的快照（不含对方刚写入的字段），
   * `$set` 整个数组会**覆盖丢失对方的写入**——表现为「图片/视频生成成功但页面查不到」。
   */
  async patchSceneOutput(
    jobId: string,
    ownerId: string,
    sceneIndex: number,
    patch: Partial<Omit<RemakeJobSceneOutput, 'sceneIndex'>>,
  ): Promise<RemakeJobRecord | null> {
    const patchEntries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (patchEntries.length === 0) {
      const existing = await this.jobs().findOne({ _id: jobId, owner_id: ownerId });
      return existing ? toJobRecord(existing) : null;
    }
    const patchObject: Record<string, unknown> = { sceneIndex };
    for (const [key, value] of patchEntries) patchObject[key] = value;

    const existingScenes = { $ifNull: ['$outputs.scenes', []] };

    const result = await this.jobs().findOneAndUpdate(
      { _id: jobId, owner_id: ownerId },
      [
        {
          $set: {
            'outputs.scenes': {
              $cond: [
                { $in: [sceneIndex, { $ifNull: ['$outputs.scenes.sceneIndex', []] }] },
                {
                  $map: {
                    input: existingScenes,
                    as: 's',
                    in: {
                      $cond: [
                        { $eq: ['$$s.sceneIndex', sceneIndex] },
                        { $mergeObjects: ['$$s', patchObject] },
                        '$$s',
                      ],
                    },
                  },
                },
                { $concatArrays: [existingScenes, [patchObject]] },
              ],
            },
            updated_at: new Date(),
          },
        },
        {
          $set: {
            'outputs.scenes': {
              $sortArray: { input: '$outputs.scenes', sortBy: { sceneIndex: 1 } },
            },
          },
        },
      ] satisfies UpdateFilter<RemakeJobDocument>[],
      { returnDocument: 'after' },
    );
    return result ? toJobRecord(result) : null;
  }

  /**
   * 原子清掉指定 scene output 字段（例如单场视频重跑前删除 videoUrl）。
   *
   * 不要在调用方用旧 job snapshot 过滤后整体 `$set outputs.scenes`：那会和
   * 并发 task output 回写互相覆盖。这里用 Mongo pipeline 在服务端逐个 scene
   * 删除目标 key，保留同一 scene 的 imageUrl/voiceUrl/mixUrl 等其它字段。
   */
  async clearSceneOutputFields(
    jobId: string,
    ownerId: string,
    sceneIndexes: number[],
    fields: Array<keyof Omit<RemakeJobSceneOutput, 'sceneIndex'>>,
  ): Promise<RemakeJobRecord | null> {
    const indexes = [
      ...new Set(sceneIndexes.filter((value) => Number.isInteger(value) && value > 0)),
    ];
    const fieldNames = [...new Set(fields.map((field) => String(field)))];
    if (indexes.length === 0 || fieldNames.length === 0) {
      const existing = await this.jobs().findOne({
        _id: jobId,
        owner_id: ownerId,
      });
      return existing ? toJobRecord(existing) : null;
    }

    const result = await this.jobs().findOneAndUpdate(
      { _id: jobId, owner_id: ownerId },
      [
        {
          $set: {
            'outputs.scenes': {
              $map: {
                input: { $ifNull: ['$outputs.scenes', []] },
                as: 's',
                in: {
                  $cond: [
                    { $in: ['$$s.sceneIndex', indexes] },
                    {
                      $arrayToObject: {
                        $filter: {
                          input: { $objectToArray: '$$s' },
                          as: 'kv',
                          cond: { $not: [{ $in: ['$$kv.k', fieldNames] }] },
                        },
                      },
                    },
                    '$$s',
                  ],
                },
              },
            },
            updated_at: new Date(),
          },
        },
      ] satisfies UpdateFilter<RemakeJobDocument>[],
      { returnDocument: 'after' },
    );
    return result ? toJobRecord(result) : null;
  }

  async clearOutputFields(
    jobId: string,
    ownerId: string,
    fields: Array<keyof Omit<RemakeJobOutputs, 'scenes' | 'environmentLocks'>>,
  ): Promise<RemakeJobRecord | null> {
    const unset: Record<string, ''> = {};
    for (const field of new Set(fields.map((value) => String(value)))) {
      unset[`outputs.${field}`] = '';
    }
    if (Object.keys(unset).length === 0) {
      const existing = await this.jobs().findOne({
        _id: jobId,
        owner_id: ownerId,
      });
      return existing ? toJobRecord(existing) : null;
    }

    const result = await this.jobs().findOneAndUpdate(
      { _id: jobId, owner_id: ownerId },
      {
        $set: { updated_at: new Date() },
        $unset: unset,
      },
      { returnDocument: 'after' },
    );
    return result ? toJobRecord(result) : null;
  }

  /**
   * 同上：environment lock 的 image url 也走 mongo 端原子 upsert，避免
   * 多个 environment 并发回写时互相覆盖。
   */
  async patchEnvironmentOutput(
    jobId: string,
    ownerId: string,
    environmentIndex: number,
    imageUrl: string,
  ): Promise<RemakeJobRecord | null> {
    const existingLocks = { $ifNull: ['$outputs.environmentLocks', []] };
    const lockObject = { environmentIndex, imageUrl };

    const result = await this.jobs().findOneAndUpdate(
      { _id: jobId, owner_id: ownerId },
      [
        {
          $set: {
            'outputs.environmentLocks': {
              $cond: [
                {
                  $in: [
                    environmentIndex,
                    { $ifNull: ['$outputs.environmentLocks.environmentIndex', []] },
                  ],
                },
                {
                  $map: {
                    input: existingLocks,
                    as: 'e',
                    in: {
                      $cond: [
                        { $eq: ['$$e.environmentIndex', environmentIndex] },
                        lockObject,
                        '$$e',
                      ],
                    },
                  },
                },
                { $concatArrays: [existingLocks, [lockObject]] },
              ],
            },
            updated_at: new Date(),
          },
        },
        {
          $set: {
            'outputs.environmentLocks': {
              $sortArray: {
                input: '$outputs.environmentLocks',
                sortBy: { environmentIndex: 1 },
              },
            },
          },
        },
      ] satisfies UpdateFilter<RemakeJobDocument>[],
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
    const keyFor = (jobId: string, sliceKey: string) => `${jobId}:${sliceKey}`;
    const filters = documents.map((doc) => ({ job_id: doc.job_id, slice_key: doc.slice_key }));
    const existing = await this.tasks()
      .find({ $or: filters }, { projection: { _id: 1, job_id: 1, slice_key: 1 } })
      .toArray();
    const existingIds = new Map(
      existing.map((doc) => [keyFor(doc.job_id, doc.slice_key), doc._id] as const),
    );

    const operations: AnyBulkWriteOperation<RemakeTaskDocument>[] = documents.map((doc) => {
      const existingId = existingIds.get(keyFor(doc.job_id, doc.slice_key));
      const update: UpdateFilter<RemakeTaskDocument> = {
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
      };

      if (existingId) {
        return {
          updateOne: {
            filter: { _id: existingId },
            update,
          },
        };
      }

      return {
        updateOne: {
          filter: { job_id: doc.job_id, slice_key: doc.slice_key },
          update: {
            ...update,
            $setOnInsert: {
              _id: doc._id,
              job_id: doc.job_id,
              slice_key: doc.slice_key,
              created_at: now,
            },
          },
          upsert: true,
        },
      };
    });

    await this.tasks().bulkWrite(operations, { ordered: false });
    const updated = await this.tasks().find({ $or: filters }).toArray();
    const byKey = new Map(updated.map((doc) => [keyFor(doc.job_id, doc.slice_key), doc] as const));
    return documents
      .map((doc) => byKey.get(keyFor(doc.job_id, doc.slice_key)))
      .filter((doc): doc is RemakeTaskDocument => Boolean(doc))
      .map(toTaskRecord);
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

    if (patch.status === 'success' || patch.status === 'error' || patch.status === 'cancelled') {
      set.settled_at = now;
    }

    if (patch.status === 'running') {
      // First time we transition to running, capture started_at; subsequent
      // running events (progress / re-runs after retry) must NOT overwrite
      // it, otherwise audit/duration metrics lose the original start time.
      // Mongo has no "set on first only" outside of upsert, so use an
      // aggregation-pipeline update with $ifNull to preserve the existing
      // value when present.
      const pipeline: Document[] = [
        {
          $set: {
            ...set,
            started_at: { $ifNull: ['$started_at', now] },
          },
        },
      ];
      if (update.$unset) {
        pipeline.push({ $unset: Object.keys(update.$unset) });
      }
      const result = await this.tasks().findOneAndUpdate({ _id: taskId }, pipeline, {
        returnDocument: 'after',
      });
      return result ? toTaskRecord(result) : null;
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

/**
 * Decide what to do with a sparse `sceneImagePrompts`/`sceneVideoPrompts`
 * array based on the current snapshot. Returns a tagged result that the
 * caller turns into a tightly-scoped `$set`/`$unset` — never `$set: { plan }`,
 * which used to overwrite concurrent unrelated edits to other plan fields.
 *
 * Semantics:
 * - explicit prompt with text  → write to slot, pad with '' as needed
 * - explicit prompt empty/null → clear slot
 * - touching action/dialogue/voiceLine while an override exists at this slot
 *   → clear that slot (matches previous behaviour: changing the source text
 *   should drop the prompt override and fall back to auto-generation)
 * - all-empty after the change  → unset the whole field (cleanup)
 * - no change requested         → noop
 */
function computeSparsePromptUpdate(
  current: string[] | undefined,
  sceneArrayIdx: number,
  sceneCount: number,
  explicitValue: string | null | undefined,
  clearWhenGenerationInputChanged: boolean,
): { kind: 'set'; value: string[] } | { kind: 'unset' } | { kind: 'noop' } {
  const explicit = explicitValue !== undefined;
  if (!explicit && !clearWhenGenerationInputChanged) return { kind: 'noop' };

  const trimmed = explicit ? (explicitValue?.trim() ?? '') : '';
  const next = [...(current ?? [])];
  while (next.length < sceneCount) next.push('');

  if (explicit) {
    next[sceneArrayIdx] = trimmed;
  } else if (clearWhenGenerationInputChanged && next[sceneArrayIdx]?.trim()) {
    next[sceneArrayIdx] = '';
  } else {
    return { kind: 'noop' };
  }

  if (next.some((entry) => entry.trim())) return { kind: 'set', value: next };
  return { kind: 'unset' };
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
  const inputPrompt = parsed.input?.prompt?.trim() || undefined;
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
    ...(inputPrompt ? { inputPrompt } : {}),
    startedAt: parsed.started_at?.toISOString(),
    settledAt: parsed.settled_at?.toISOString(),
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
  });
}

export { STAGE_NAMES };
