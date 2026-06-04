import 'server-only';

import type {
  RemakeJobPlan,
  RemakeJobRecord,
  RemakeJobSettings,
  RemakeStageName,
  RemakeStageStatus,
  RemakeTaskRecord,
  RemakeTaskStatus,
} from '@lumen/db';

import type { Locale } from '@/i18n/routing';
import { getRemakeJobRepository } from '@/server/db';
import type { RemakeBreakdown } from '@/server/remakeAnalysis';
import type { RemakePlan, RemakeReference } from '@/server/remakePlan';

import { type RemakeEvent, dispatchTasks, publishJobEvent, setJobCancelled } from './dispatch';
import { buildPlanForJob, resolveReferenceVideo } from './planning';
import {
  type PlannedTask,
  SliceKeys,
  deriveJobStageStatuses,
  expandFinalStage,
  expandLockStage,
  expandStoryboardStage,
  expandVideoStage,
  parseSceneIndexFromSliceKey,
  planSceneMixTask,
  sliceOutputField,
} from './stages';

/**
 * 爆款复刻 —— Job 业务层。
 *
 * 把 schema / repository（数据） + stages（编排逻辑） + dispatch（传输） 串起来，
 * 给上层 HTTP route 提供"创建 job / 触发 stage / 接收 task 结果 / 重新规划 / 取消"这几个动作。
 *
 * 关键设计：
 * - 所有写都先落 Mongo，再触发副作用（Redis dispatch / publish event）。
 *   Mongo 写失败 = 整个动作回退；Redis 写失败 = 日志告警，job 仍处于一致状态。
 * - task 完成事件来时，先更新 task 文档 → 把 outputUrl 反映射到 job.outputs → 推导
 *   stage 状态 → 必要时自动 enqueue 下游 task（如 mix）→ publish 给 SSE。
 * - 整套接口对 owner 严格鉴权（用 ownerId 校验所有读写）。
 */

// ============================================================
// Job 创建 / 列表 / 详情
// ============================================================

export interface CreateRemakeJobOptions {
  ownerId: string;
  reference: RemakeReference;
  videoId?: string;
  settings: RemakeJobSettings;
  productImageUrls: string[];
  creatorImageUrls?: string[];
  userPrompt?: string;
  locale: Locale;
}

export interface RemakeJobView {
  job: RemakeJobRecord;
  tasks: RemakeTaskRecord[];
  stageStatuses: Record<RemakeStageName, RemakeStageStatus>;
}

export async function createRemakeJob(options: CreateRemakeJobOptions): Promise<RemakeJobView> {
  const video = await resolveReferenceVideo(options.videoId, options.locale);
  const { plan, breakdown } = await buildPlanForJob({
    reference: options.reference,
    video,
    productImageCount: options.productImageUrls.length,
    creatorImageCount: options.creatorImageUrls?.length ?? 0,
    locale: options.locale,
    userPrompt: options.userPrompt,
    targetDurationSeconds: options.settings.durationSeconds,
  });

  const repository = await getRemakeJobRepository();
  const job = await repository.createJob({
    ownerId: options.ownerId,
    videoId: options.videoId,
    reference: options.reference,
    settings: options.settings,
    plan: toJobPlan(plan),
    breakdown: breakdown ? toJobBreakdown(breakdown) : undefined,
    productImageUrls: options.productImageUrls,
    creatorImageUrls: options.creatorImageUrls ?? [],
    userPrompt: options.userPrompt,
  });

  await publishJobEvent({ type: 'job:updated', jobId: job.id });
  return composeView(job, []);
}

export async function getRemakeJobView(
  jobId: string,
  ownerId: string,
): Promise<RemakeJobView | null> {
  const repository = await getRemakeJobRepository();
  const job = await repository.getJob(jobId, ownerId);
  if (!job) return null;
  const tasks = await repository.listTasksByJob(jobId);
  return composeView(job, tasks);
}

export async function listRemakeJobsForUser(
  ownerId: string,
  options: { limit?: number } = {},
): Promise<RemakeJobRecord[]> {
  const repository = await getRemakeJobRepository();
  return repository.listJobsForOwner(ownerId, {
    status: 'active',
    limit: options.limit,
  });
}

// ============================================================
// Gate 确认
// ============================================================

export async function confirmGate1(input: {
  jobId: string;
  ownerId: string;
  scriptText: string;
  sellingPoints: string[];
  audienceTags: string[];
  /** 用户在 Gate 1 选的口播语言 —— 落到 settings.language，并影响下次 plan 默认声线。 */
  voiceLanguage?: 'zh' | 'en';
  locale: Locale;
}): Promise<RemakeJobView | null> {
  const repository = await getRemakeJobRepository();
  const job = await repository.getJob(input.jobId, input.ownerId);
  if (!job) return null;
  if (
    job.stages.lock.status === 'running' ||
    job.stages.storyboard.status === 'running' ||
    job.stages.video.status === 'running' ||
    job.stages.final.status === 'running'
  ) {
    throw new Error(
      'Cannot confirm Gate 1 while downstream stages are running. Cancel them first.',
    );
  }

  const video = await resolveReferenceVideo(job.videoId, input.locale);
  const { plan, breakdown } = await buildPlanForJob({
    reference: job.reference,
    video,
    productImageCount: job.productImageUrls.length,
    creatorImageCount: job.creatorImageUrls.length,
    locale: input.locale,
    userPrompt: job.userPrompt,
    targetDurationSeconds: job.settings.durationSeconds,
    gateOverrides: {
      scriptText: input.scriptText,
      sellingPoints: input.sellingPoints,
      audienceTags: input.audienceTags,
    },
  });

  // Gate 1 把所有下游 task / output 清空 —— 场次数可能变了，旧数据不可信。
  await repository.deleteTasksByStages(input.jobId, ['lock', 'storyboard', 'video', 'final']);

  const nextSettings: RemakeJobSettings | undefined = input.voiceLanguage
    ? { ...job.settings, language: input.voiceLanguage }
    : undefined;
  // 用户切换语言时把声线一并钉死在 plan 里，避免 stages.ts pickDefaultVoice 再去猜。
  const planWithVoice = input.voiceLanguage
    ? { ...plan, voice: input.voiceLanguage === 'zh' ? 'AD_Sister' : 'Rachel' }
    : plan;

  const updated = await repository.updateJob(input.jobId, input.ownerId, {
    plan: toJobPlan(planWithVoice),
    breakdown: breakdown ? toJobBreakdown(breakdown) : undefined,
    ...(nextSettings ? { settings: nextSettings } : {}),
    gate1ConfirmedAt: new Date(),
    gate2ConfirmedAt: undefined,
    outputsPatch: {
      // 强制清空所有下游 output —— scenes 数组重置为空，replan 后场次数可能变
      scenes: [],
    },
    stagePatch: {
      name: 'lock',
      state: { status: 'ready' },
    },
  });
  if (!updated) return null;

  await publishJobEvent({ type: 'job:updated', jobId: input.jobId });
  return getRemakeJobView(input.jobId, input.ownerId);
}

export async function confirmGate2(input: {
  jobId: string;
  ownerId: string;
}): Promise<RemakeJobView | null> {
  const repository = await getRemakeJobRepository();
  const job = await repository.getJob(input.jobId, input.ownerId);
  if (!job) return null;

  // 进入 video 阶段前，把已有的 video/final tasks 全清掉，避免拿到旧数据
  await repository.deleteTasksByStages(input.jobId, ['video', 'final']);

  const updated = await repository.updateJob(input.jobId, input.ownerId, {
    gate2ConfirmedAt: new Date(),
    outputsPatch: {
      // 清掉每场的 video/voice/mix output（保留 image），bgm/final 也清
      scenes: job.outputs.scenes.map((scene) => ({
        sceneIndex: scene.sceneIndex,
        ...(scene.imageUrl ? { imageUrl: scene.imageUrl } : {}),
      })),
    },
  });
  if (!updated) return null;

  await publishJobEvent({ type: 'job:updated', jobId: input.jobId });
  return getRemakeJobView(input.jobId, input.ownerId);
}

// ============================================================
// Stage 触发
// ============================================================

export async function runStage(input: {
  jobId: string;
  ownerId: string;
  stage: RemakeStageName;
}): Promise<RemakeJobView | null> {
  const repository = await getRemakeJobRepository();
  const job = await repository.getJob(input.jobId, input.ownerId);
  if (!job) return null;

  // 推导当前 stage 状态，校验门控
  const tasks = await repository.listTasksByJob(input.jobId);
  const statuses = deriveJobStageStatuses(job, tasks);
  if (statuses[input.stage] === 'locked') {
    throw new Error(`Stage "${input.stage}" is locked by upstream gate or stage.`);
  }

  let planned: PlannedTask[] = [];
  if (input.stage === 'lock') {
    planned = expandLockStage(job);
  } else if (input.stage === 'storyboard') {
    planned = expandStoryboardStage(job);
  } else if (input.stage === 'video') {
    planned = expandVideoStage(job);
  } else if (input.stage === 'final') {
    const final = expandFinalStage(job);
    if (!final) {
      throw new Error('Final stage cannot start until all scene mixes and BGM are ready.');
    }
    planned = [final];
  } else {
    throw new Error(`Stage "${input.stage}" is not directly runnable.`);
  }

  if (planned.length === 0) return composeView(job, tasks);

  // 1. 创建 task 文档（upsert by sliceKey）
  const created = await repository.createTasks(
    planned.map((task) => ({
      jobId: input.jobId,
      stage: task.stage,
      sliceKey: task.sliceKey,
      handler: task.handler,
      input: task.input,
      settings: task.settings,
    })),
  );

  // 2. patch stage state → running
  await repository.updateJob(input.jobId, input.ownerId, {
    stagePatch: {
      name: input.stage,
      state: { status: 'running', startedAt: new Date() },
    },
    error: null,
  });

  // 3. 派发到 Redis Stream
  await dispatchTasks(
    created.map((task) => ({
      taskId: task.id,
      jobId: input.jobId,
      ownerId: input.ownerId,
      stage: task.stage,
      sliceKey: task.sliceKey,
      handler: task.handler,
      inputJson: JSON.stringify(planned.find((p) => p.sliceKey === task.sliceKey)?.input ?? {}),
      settingsJson: JSON.stringify(
        planned.find((p) => p.sliceKey === task.sliceKey)?.settings ?? {},
      ),
    })),
  );

  // 4. 发 task:queued 事件给 SSE
  for (const task of created) {
    await publishJobEvent({
      type: 'task:queued',
      jobId: input.jobId,
      taskId: task.id,
      stage: task.stage,
      sliceKey: task.sliceKey,
    });
  }
  await publishJobEvent({
    type: 'stage:status',
    jobId: input.jobId,
    stage: input.stage,
    status: 'running',
  });

  return getRemakeJobView(input.jobId, input.ownerId);
}

// ============================================================
// Task 完成事件（由 engine event → studio mirror → 这个函数）
// ============================================================

export interface RecordTaskOutcomeInput {
  jobId: string;
  ownerId: string;
  taskId: string;
  status: RemakeTaskStatus;
  progress?: number;
  outputUrl?: string;
  outputKind?: 'image' | 'video' | 'audio' | 'text';
  error?: string;
}

export async function recordTaskOutcome(input: RecordTaskOutcomeInput): Promise<void> {
  const repository = await getRemakeJobRepository();
  const task = await repository.patchTaskStatus(input.taskId, {
    status: input.status,
    progress: input.progress,
    outputUrl: input.outputUrl,
    outputKind: input.outputKind,
    error: input.error ?? null,
  });
  if (!task) return;

  // 把 output 反映射到 job.outputs
  if (input.status === 'success' && input.outputUrl) {
    await applyTaskOutputToJob(input.jobId, input.ownerId, task.sliceKey, input.outputUrl);
  }

  // 推导 stage 状态 → patch
  const job = await repository.getJob(input.jobId, input.ownerId);
  if (!job) return;
  const allTasks = await repository.listTasksByJob(input.jobId);
  const stageStatuses = deriveJobStageStatuses(job, allTasks);
  await repository.updateJob(input.jobId, input.ownerId, {
    stagePatch: {
      name: task.stage,
      state: {
        status: stageStatuses[task.stage],
        ...(stageStatuses[task.stage] === 'success' ? { settledAt: new Date() } : {}),
      },
    },
  });

  // video stage 内：scene-video-N + scene-voice-N 都 success 且 scene-mix-N 还没存在 → enqueue
  if (
    task.stage === 'video' &&
    input.status === 'success' &&
    (task.sliceKey.startsWith('scene-video-') || task.sliceKey.startsWith('scene-voice-'))
  ) {
    await maybeEnqueueSceneMix(input.jobId, input.ownerId, task.sliceKey);
  }

  // video stage 内全部 mix + bgm 都 success → 自动把 stage 标 success 并发事件
  // 上面 deriveJobStageStatuses 已经算过了

  // 发事件
  const event: RemakeEvent =
    input.status === 'success' && input.outputUrl
      ? {
          type: 'task:done',
          jobId: input.jobId,
          taskId: input.taskId,
          stage: task.stage,
          sliceKey: task.sliceKey,
          outputUrl: input.outputUrl,
          outputKind: input.outputKind ?? 'text',
        }
      : input.status === 'error'
        ? {
            type: 'task:error',
            jobId: input.jobId,
            taskId: input.taskId,
            stage: task.stage,
            sliceKey: task.sliceKey,
            error: input.error ?? 'unknown error',
          }
        : input.status === 'cancelled'
          ? {
              type: 'task:cancelled',
              jobId: input.jobId,
              taskId: input.taskId,
              stage: task.stage,
              sliceKey: task.sliceKey,
              reason: input.error ?? 'cancelled',
            }
          : {
              type: 'task:progress',
              jobId: input.jobId,
              taskId: input.taskId,
              stage: task.stage,
              sliceKey: task.sliceKey,
              progress: input.progress ?? 0,
            };
  await publishJobEvent(event);
  await publishJobEvent({
    type: 'stage:status',
    jobId: input.jobId,
    stage: task.stage,
    status: stageStatuses[task.stage],
  });
}

async function applyTaskOutputToJob(
  jobId: string,
  ownerId: string,
  sliceKey: string,
  outputUrl: string,
): Promise<void> {
  const repository = await getRemakeJobRepository();
  const field = sliceOutputField(sliceKey);
  if (!field) return;

  if (
    field === 'creatorLockUrl' ||
    field === 'productLockUrl' ||
    field === 'bgmUrl' ||
    field === 'finalUrl'
  ) {
    await repository.updateJob(jobId, ownerId, {
      outputsPatch: { [field]: outputUrl },
    });
    return;
  }

  const sceneIndex = parseSceneIndexFromSliceKey(sliceKey);
  if (sceneIndex === null) return;
  await repository.patchSceneOutput(jobId, ownerId, sceneIndex, { [field]: outputUrl });
}

async function maybeEnqueueSceneMix(
  jobId: string,
  ownerId: string,
  triggerSliceKey: string,
): Promise<void> {
  const sceneIndex = parseSceneIndexFromSliceKey(triggerSliceKey);
  if (sceneIndex === null) return;

  const repository = await getRemakeJobRepository();
  const job = await repository.getJob(jobId, ownerId);
  if (!job) return;
  const mix = planSceneMixTask(job, sceneIndex);
  if (!mix) return;

  // 检查是否已经派发过这一场的 mix
  const existing = await repository
    .listTasksByJob(jobId)
    .then((tasks) => tasks.find((task) => task.sliceKey === mix.sliceKey));
  if (
    existing &&
    (existing.status === 'queued' || existing.status === 'running' || existing.status === 'success')
  ) {
    return;
  }

  const [created] = await repository.createTasks([
    {
      jobId,
      stage: mix.stage,
      sliceKey: mix.sliceKey,
      handler: mix.handler,
      input: mix.input,
      settings: mix.settings,
    },
  ]);
  if (!created) return;

  await dispatchTasks([
    {
      taskId: created.id,
      jobId,
      ownerId,
      stage: created.stage,
      sliceKey: created.sliceKey,
      handler: created.handler,
      inputJson: JSON.stringify(mix.input),
      settingsJson: JSON.stringify(mix.settings),
    },
  ]);
  await publishJobEvent({
    type: 'task:queued',
    jobId,
    taskId: created.id,
    stage: created.stage,
    sliceKey: created.sliceKey,
  });
}

// ============================================================
// 取消
// ============================================================

export async function cancelRemakeJob(input: {
  jobId: string;
  ownerId: string;
  reason?: string;
}): Promise<RemakeJobView | null> {
  const repository = await getRemakeJobRepository();
  const job = await repository.getJob(input.jobId, input.ownerId);
  if (!job) return null;

  const reason = input.reason?.trim() || 'cancelled by user';
  await setJobCancelled(input.jobId, reason);
  await repository.cancelTasksByStages(input.jobId, ['lock', 'storyboard', 'video', 'final']);
  await publishJobEvent({ type: 'job:updated', jobId: input.jobId });
  return getRemakeJobView(input.jobId, input.ownerId);
}

// ============================================================
// 内部：组装 view + 类型转换
// ============================================================

function composeView(job: RemakeJobRecord, tasks: RemakeTaskRecord[]): RemakeJobView {
  return {
    job,
    tasks,
    stageStatuses: deriveJobStageStatuses(job, tasks),
  };
}

function toJobPlan(plan: RemakePlan & { voice?: string }): RemakeJobPlan {
  return {
    scriptText: plan.scriptText,
    scenes: plan.scenes.map((scene) => ({
      index: scene.index,
      action: scene.action,
      dialogue: scene.dialogue,
      ...(scene.voiceLine ? { voiceLine: scene.voiceLine } : {}),
      durationSeconds: scene.durationSeconds,
      camera: scene.camera,
    })),
    sellingPoints: plan.sellingPoints,
    audienceTags: plan.audienceTags,
    ...(plan.creatorPrompt ? { creatorPrompt: plan.creatorPrompt } : {}),
    ...(plan.productPrompt ? { productPrompt: plan.productPrompt } : {}),
    ...(plan.bgmPrompt ? { bgmPrompt: plan.bgmPrompt } : {}),
    ...(plan.sceneImagePrompts ? { sceneImagePrompts: plan.sceneImagePrompts } : {}),
    ...(plan.sceneVideoPrompts ? { sceneVideoPrompts: plan.sceneVideoPrompts } : {}),
    ...(plan.voice ? { voice: plan.voice } : {}),
  };
}

function toJobBreakdown(breakdown: RemakeBreakdown) {
  // db schema 不持久化 generatedAt（与 job.createdAt 重复）；其余字段 1:1
  return {
    durationSec: breakdown.durationSec,
    hook: breakdown.hook,
    angle: breakdown.angle,
    summary: breakdown.summary,
    transcript: breakdown.transcript,
    shots: breakdown.shots,
    language: breakdown.language,
  };
}

// 让 stages.ts 的 SliceKeys 也可在 jobs.ts 之外使用
export { SliceKeys };
