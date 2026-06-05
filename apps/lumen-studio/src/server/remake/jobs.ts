import 'server-only';

import type {
  RemakeJobPlan,
  RemakeJobRecord,
  RemakeJobSettings,
  RemakeStageName,
  RemakeStageStatus,
  RemakeTaskRecord,
} from '@lumen/db';

import type { Locale } from '@/i18n/routing';
import { getRemakeJobRepository } from '@/server/db';
import type { RemakeBreakdown } from '@/server/remakeAnalysis';
import type { RemakePlan, RemakeReference } from '@/server/remakePlan';

import { dispatchTasks, setJobCancelled } from './dispatch';
import { buildPlanForJob, resolveReferenceVideo } from './planning';
import {
  type PlannedTask,
  SliceKeys,
  deriveJobStageStatuses,
  expandFinalStage,
  expandLockStage,
  expandStoryboardStage,
  expandVideoStage,
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
    productImageUrls: options.productImageUrls,
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
    productImageUrls: job.productImageUrls,
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

  const updated = await repository.updateJob(input.jobId, input.ownerId, {
    plan: toJobPlan(plan),
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

  return getRemakeJobView(input.jobId, input.ownerId);
}

// ============================================================
// Stage 触发
// ============================================================

export async function runStage(input: {
  jobId: string;
  ownerId: string;
  stage: RemakeStageName;
  /** 若给出则只跑这几个 slice（单张分镜重跑 / 单场视频重跑 / etc.）。 */
  sliceKeys?: string[];
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
    planned = await expandStoryboardStage(job);
  } else if (input.stage === 'video') {
    planned = await expandVideoStage(job);
  } else if (input.stage === 'final') {
    const final = expandFinalStage(job);
    if (!final) {
      throw new Error('Final stage cannot start until all scene mixes and BGM are ready.');
    }
    planned = [final];
  } else {
    throw new Error(`Stage "${input.stage}" is not directly runnable.`);
  }

  if (input.sliceKeys && input.sliceKeys.length > 0) {
    const wanted = new Set(input.sliceKeys);
    planned = planned.filter((task) => wanted.has(task.sliceKey));
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

  return getRemakeJobView(input.jobId, input.ownerId);
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
