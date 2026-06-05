import { z } from 'zod';

/**
 * 爆款复刻 —— Job 文档模型（v3 任务化架构）。
 *
 * 一次"复刻"对应一个 RemakeJob。Job 持有：
 * - 不变的：plan、breakdown、用户上传的素材 URL、配置
 * - 在变的：每个 stage 的状态、每个 task 的状态/输出、用户的 gate 确认时间戳
 *
 * Stage / Task 的语义：
 * - Stage 是 UI 上的"步骤"（lock / storyboard / video / final）
 * - Task 是 stage 展开后的原子单位（每个 handler 调用一次 = 一个 task）
 * - 同一 stage 内 task 多数并行；少数有场内依赖（如 scene-mix 依赖 scene-video + scene-voice）
 * - Stage 的完成 = 该 stage 下所有 task 都 success
 *
 * 这份 schema 同时承载 MongoDB 持久化（snake_case 字段）和对外 record（camelCase）。
 * Document 用 snake_case 是为了和现有 collection 一致。
 */

export const REMAKE_JOBS_COLLECTION = 'studio_remake_jobs';
export const REMAKE_TASKS_COLLECTION = 'studio_remake_tasks';

// ============================================================
// Plan & Breakdown（与 server/remakePlan / remakeAnalysis 对齐）
// ============================================================

const RemakeSceneSchema = z
  .object({
    index: z.number().int().min(1),
    action: z.string().trim().min(1).max(400),
    dialogue: z.string().trim().min(1).max(400),
    voiceLine: z.string().trim().max(400).optional(),
    durationSeconds: z.number().positive().max(60),
    camera: z.string().trim().min(1).max(280),
  })
  .strict();
export type RemakeJobScene = z.infer<typeof RemakeSceneSchema>;

const RemakeCharacterSchema = z
  .object({
    name: z.string().trim().min(1).max(60),
    gender: z.enum(['female', 'male', 'unspecified']),
    ageRange: z.string().trim().min(1).max(40),
    tone: z.string().trim().min(1).max(120),
  })
  .strict();
export type RemakeJobCharacter = z.infer<typeof RemakeCharacterSchema>;

const RemakePlanSchema = z
  .object({
    scriptText: z.string().trim().min(1),
    scenes: z.array(RemakeSceneSchema).min(1).max(10),
    sellingPoints: z.array(z.string().trim().min(1)).max(8),
    audienceTags: z.array(z.string().trim().min(1)).max(8),
    creatorPrompt: z.string().trim().optional(),
    productPrompt: z.string().trim().optional(),
    bgmPrompt: z.string().trim().optional(),
    sceneImagePrompts: z.array(z.string().trim().min(1)).optional(),
    sceneVideoPrompts: z.array(z.string().trim().min(1)).optional(),
    /** TTS 声线 id（fish-tts voice 名）；前端选了语言后由后端解析 */
    voice: z.string().trim().optional(),
    /** 主流 UGC 风格的角色身份卡，用于视频 prompt 里 @Name (VO, gender) says 语法锁口型。 */
    character: RemakeCharacterSchema.optional(),
  })
  .strict();
export type RemakeJobPlan = z.infer<typeof RemakePlanSchema>;

const RemakeTranscriptItemSchema = z
  .object({
    startSec: z.number().nonnegative(),
    endSec: z.number().nonnegative(),
    text: z.string().trim().max(600),
  })
  .strict();

const RemakeShotItemSchema = z
  .object({
    startSec: z.number().nonnegative(),
    endSec: z.number().nonnegative(),
    action: z.string().trim().max(400),
    actionPattern: z.string().trim().max(280).optional(),
    camera: z.string().trim().max(280),
    visual: z.string().trim().max(400),
    dialogue: z.string().trim().max(400).optional(),
  })
  .strict();

const RemakeBreakdownSchema = z
  .object({
    durationSec: z.number().positive(),
    hook: z.string().trim().max(400),
    angle: z.string().trim().max(400),
    summary: z.string().trim().max(800),
    transcript: z.array(RemakeTranscriptItemSchema).max(60),
    shots: z.array(RemakeShotItemSchema).max(20),
    language: z.string().trim().max(20),
  })
  .strict();
export type RemakeJobBreakdown = z.infer<typeof RemakeBreakdownSchema>;

// ============================================================
// Job：stage / output / gate 状态
// ============================================================

export const RemakeStageNameSchema = z.enum([
  'breakdown',
  'script',
  'lock',
  'storyboard',
  'video',
  'final',
]);
export type RemakeStageName = z.infer<typeof RemakeStageNameSchema>;

export const RemakeStageStatusSchema = z.enum([
  'locked', // 上游门控/上游 stage 没通过
  'ready', // 上游齐了，等用户触发
  'running', // 该 stage 至少有一个 task 在跑或排队
  'success', // 该 stage 下所有 task 都 success
  'error', // 该 stage 下至少一个 task 终态 error，没有正在跑的
  'cancelled',
]);
export type RemakeStageStatus = z.infer<typeof RemakeStageStatusSchema>;

const RemakeStageStateSchema = z
  .object({
    status: RemakeStageStatusSchema,
    /** 最近一次触发的时间，用于排序/审计 */
    startedAt: z.date().optional(),
    /** 最近一次到达终态的时间（success/error/cancelled） */
    settledAt: z.date().optional(),
  })
  .strict();
export type RemakeStageState = z.infer<typeof RemakeStageStateSchema>;

const RemakeReferenceSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1).max(180),
    value: z.string().trim().min(1).max(500),
    source: z.enum(['link', 'video']),
    title: z.string().trim().max(240).optional(),
    productName: z.string().trim().max(120).optional(),
    category: z.string().trim().max(40).optional(),
    region: z.string().trim().max(40).optional(),
    thumbnailUrl: z.string().trim().url().optional(),
    previewUrl: z.string().trim().url().optional(),
  })
  .strict();
export type RemakeJobReference = z.infer<typeof RemakeReferenceSchema>;

const RemakeJobSceneOutputSchema = z
  .object({
    /** scene.index（1-based） */
    sceneIndex: z.number().int().min(1),
    imageUrl: z.string().trim().url().optional(),
    videoUrl: z.string().trim().url().optional(),
    voiceUrl: z.string().trim().url().optional(),
    mixUrl: z.string().trim().url().optional(),
  })
  .strict();
export type RemakeJobSceneOutput = z.infer<typeof RemakeJobSceneOutputSchema>;

const RemakeJobOutputsSchema = z
  .object({
    creatorLockUrl: z.string().trim().url().optional(),
    productLockUrl: z.string().trim().url().optional(),
    scenes: z.array(RemakeJobSceneOutputSchema).default([]),
    bgmUrl: z.string().trim().url().optional(),
    finalUrl: z.string().trim().url().optional(),
  })
  .strict();
export type RemakeJobOutputs = z.infer<typeof RemakeJobOutputsSchema>;

const RemakeJobSettingsSchema = z
  .object({
    aspectRatio: z.string().trim().default('9:16'),
    resolution: z.enum(['720p', '1080p']).default('720p'),
    language: z.enum(['zh', 'en']).default('en'),
    /** 用户期望的总时长（秒，提示用，非硬约束） */
    durationSeconds: z.number().int().min(5).max(120).optional(),
  })
  .strict();
export type RemakeJobSettings = z.infer<typeof RemakeJobSettingsSchema>;

// ============================================================
// Document（Mongo 持久层，snake_case）
// ============================================================

export const RemakeJobDocumentSchema = z
  .object({
    _id: z.string().min(1),
    owner_id: z.string().trim().min(1).max(120),
    /** 源爆款视频 id（hot_videos._id）。手动链接则为 undefined。 */
    video_id: z.string().trim().max(120).optional(),
    reference: RemakeReferenceSchema,
    settings: RemakeJobSettingsSchema,
    plan: RemakePlanSchema,
    breakdown: RemakeBreakdownSchema.optional(),
    /** 用户上传，jobs 创建时固定下来；replan 不变 */
    product_image_urls: z.array(z.string().trim().url()).min(1).max(9),
    creator_image_urls: z.array(z.string().trim().url()).max(2).default([]),
    /** 用户在 ReplicaConfigModal 里写的额外文字（可能影响 replan） */
    user_prompt: z.string().trim().max(1200).optional(),
    /** 6 个 stage 的状态机 */
    stages: z.object({
      breakdown: RemakeStageStateSchema,
      script: RemakeStageStateSchema,
      lock: RemakeStageStateSchema,
      storyboard: RemakeStageStateSchema,
      video: RemakeStageStateSchema,
      final: RemakeStageStateSchema,
    }),
    /** 用户对 gate 1（脚本）和 gate 2（分镜）的显式确认时间戳 */
    gate1_confirmed_at: z.date().optional(),
    gate2_confirmed_at: z.date().optional(),
    /** 各 task 完成后落盘的 output URL，按场次索引 */
    outputs: RemakeJobOutputsSchema,
    status: z.enum(['active', 'archived']).default('active'),
    error: z.string().trim().max(2000).optional(),
    created_at: z.date(),
    updated_at: z.date(),
  })
  .strict();
export type RemakeJobDocument = z.infer<typeof RemakeJobDocumentSchema>;

// ============================================================
// Record（对外 API，camelCase）
// ============================================================

export const RemakeJobRecordSchema = z
  .object({
    id: z.string(),
    ownerId: z.string(),
    videoId: z.string().optional(),
    reference: RemakeReferenceSchema,
    settings: RemakeJobSettingsSchema,
    plan: RemakePlanSchema,
    breakdown: RemakeBreakdownSchema.optional(),
    productImageUrls: z.array(z.string()),
    creatorImageUrls: z.array(z.string()),
    userPrompt: z.string().optional(),
    stages: z.object({
      breakdown: RemakeStageStateSchema,
      script: RemakeStageStateSchema,
      lock: RemakeStageStateSchema,
      storyboard: RemakeStageStateSchema,
      video: RemakeStageStateSchema,
      final: RemakeStageStateSchema,
    }),
    gate1ConfirmedAt: z.string().datetime().optional(),
    gate2ConfirmedAt: z.string().datetime().optional(),
    outputs: RemakeJobOutputsSchema,
    status: z.enum(['active', 'archived']),
    error: z.string().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type RemakeJobRecord = z.infer<typeof RemakeJobRecordSchema>;

// ============================================================
// Task：原子执行单元
// ============================================================

export const RemakeTaskHandlerSchema = z.enum([
  'nano-banana2',
  'veo-3.1',
  'fish-tts',
  'suno-music',
  'lumen-video-edit',
]);
export type RemakeTaskHandler = z.infer<typeof RemakeTaskHandlerSchema>;

export const RemakeTaskStatusSchema = z.enum([
  'queued',
  'running',
  'success',
  'error',
  'cancelled',
]);
export type RemakeTaskStatus = z.infer<typeof RemakeTaskStatusSchema>;

/**
 * Task 入参形态 —— 与 engine WorkflowNode.input 对齐，但简化为
 * 只保留爆款复刻实际用到的字段。这是 engine remake-consumer 直接调用
 * handler.execute() 时传进去的 ResolvedInput。
 */
const RemakeTaskInputSchema = z
  .object({
    prompt: z.string().default(''),
    image: z.string().trim().nullable().default(null),
    lastFrameImage: z.string().trim().nullable().default(null),
    /** 单片混音用：要混的视频源 */
    video: z.string().trim().nullable().default(null),
    /** 多片拼接用：按顺序的视频源 */
    videos: z.array(z.string().trim().min(1)).default([]),
    /** 单 BGM / 单口播 */
    audio: z.string().trim().nullable().default(null),
    /** 多音频混合（成片：bgm + 也许将来多语种口播） */
    audios: z.array(z.string().trim().min(1)).default([]),
    /** 拼接片段（带 title/duration/start） */
    clips: z
      .array(
        z
          .object({
            url: z.string().trim().min(1),
            start: z.number().nonnegative().optional(),
            duration: z.number().positive().optional(),
            volume: z.number().min(0).max(1).optional(),
            title: z.string().trim().max(120).optional(),
          })
          .strict(),
      )
      .default([]),
  })
  .strict();
export type RemakeTaskInput = z.infer<typeof RemakeTaskInputSchema>;

export const RemakeTaskDocumentSchema = z
  .object({
    _id: z.string().min(1),
    job_id: z.string().min(1),
    stage: RemakeStageNameSchema,
    /** 同 stage 内的稳定切片 key，例如 "creator-lock" / "scene-image-3" / "scene-mix-2" */
    slice_key: z.string().min(1).max(80),
    handler: RemakeTaskHandlerSchema,
    input: RemakeTaskInputSchema,
    settings: z.record(z.unknown()).default({}),
    status: RemakeTaskStatusSchema,
    /** 任务输出的最终 URL（R2 持久化或 data: URL）。仅 success 时有值。 */
    output_url: z.string().trim().min(1).max(2000).optional(),
    /** 任务输出原始类型（image / video / audio / text）。 */
    output_kind: z.enum(['image', 'video', 'audio', 'text']).optional(),
    progress: z.number().min(0).max(1).default(0),
    error: z.string().trim().max(2000).optional(),
    /** Redis Stream 中的 message id，方便 ack 调试 */
    stream_message_id: z.string().trim().max(80).optional(),
    started_at: z.date().optional(),
    settled_at: z.date().optional(),
    created_at: z.date(),
    updated_at: z.date(),
  })
  .strict();
export type RemakeTaskDocument = z.infer<typeof RemakeTaskDocumentSchema>;

export const RemakeTaskRecordSchema = z
  .object({
    id: z.string(),
    jobId: z.string(),
    stage: RemakeStageNameSchema,
    sliceKey: z.string(),
    handler: RemakeTaskHandlerSchema,
    status: RemakeTaskStatusSchema,
    outputUrl: z.string().optional(),
    outputKind: z.enum(['image', 'video', 'audio', 'text']).optional(),
    progress: z.number(),
    error: z.string().optional(),
    startedAt: z.string().datetime().optional(),
    settledAt: z.string().datetime().optional(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type RemakeTaskRecord = z.infer<typeof RemakeTaskRecordSchema>;

// ============================================================
// Create / Update input schemas
// ============================================================

export const CreateRemakeJobInputSchema = z
  .object({
    ownerId: z.string().trim().min(1).max(120),
    videoId: z.string().trim().max(120).optional(),
    reference: RemakeReferenceSchema,
    settings: RemakeJobSettingsSchema,
    plan: RemakePlanSchema,
    breakdown: RemakeBreakdownSchema.optional(),
    productImageUrls: z.array(z.string().trim().url()).min(1).max(9),
    creatorImageUrls: z.array(z.string().trim().url()).max(2).default([]),
    userPrompt: z.string().trim().max(1200).optional(),
  })
  .strict();
export type CreateRemakeJobInput = z.infer<typeof CreateRemakeJobInputSchema>;

export const UpdateRemakeJobInputSchema = z
  .object({
    plan: RemakePlanSchema.optional(),
    breakdown: RemakeBreakdownSchema.optional(),
    settings: RemakeJobSettingsSchema.optional(),
    productImageUrls: z.array(z.string().trim().url()).min(1).max(9).optional(),
    creatorImageUrls: z.array(z.string().trim().url()).max(2).optional(),
    userPrompt: z.string().trim().max(1200).optional(),
    /** patch 单个 stage 状态 —— jobs 内部用 */
    stagePatch: z
      .object({
        name: RemakeStageNameSchema,
        state: RemakeStageStateSchema,
      })
      .optional(),
    /** patch outputs（增量合并到 scenes / 顶层 url） */
    outputsPatch: z
      .object({
        creatorLockUrl: z.string().trim().url().optional(),
        productLockUrl: z.string().trim().url().optional(),
        scenes: z.array(RemakeJobSceneOutputSchema).optional(),
        bgmUrl: z.string().trim().url().optional(),
        finalUrl: z.string().trim().url().optional(),
      })
      .optional(),
    gate1ConfirmedAt: z.date().optional(),
    gate2ConfirmedAt: z.date().optional(),
    status: z.enum(['active', 'archived']).optional(),
    error: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();
export type UpdateRemakeJobInput = z.infer<typeof UpdateRemakeJobInputSchema>;

// ============================================================
// Re-export 子 schemas 给业务层
// ============================================================

export {
  RemakeBreakdownSchema,
  RemakePlanSchema,
  RemakeReferenceSchema,
  RemakeJobSettingsSchema,
  RemakeStageStateSchema,
  RemakeJobOutputsSchema,
  RemakeJobSceneOutputSchema,
  RemakeTaskInputSchema,
};
