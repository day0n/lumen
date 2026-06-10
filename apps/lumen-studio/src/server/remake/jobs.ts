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
  environmentImageUrls?: string[];
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
  const { plan, breakdown, targetProductName, targetProductCategory } = await buildPlanForJob({
    reference: options.reference,
    video,
    productImageUrls: options.productImageUrls,
    environmentImageUrls: options.environmentImageUrls ?? [],
    creatorImageCount: options.creatorImageUrls?.length ?? 0,
    locale: options.locale,
    userPrompt: options.userPrompt,
    targetDurationSeconds: options.settings.durationSeconds,
  });

  const repository = await getRemakeJobRepository();
  const reference = applyTargetProductToReference(options.reference, {
    productName: targetProductName,
    category: targetProductCategory,
  });
  const job = await repository.createJob({
    ownerId: options.ownerId,
    videoId: options.videoId,
    reference,
    settings: options.settings,
    plan: toJobPlan(plan),
    breakdown: breakdown ? toJobBreakdown(breakdown) : undefined,
    productImageUrls: options.productImageUrls,
    creatorImageUrls: options.creatorImageUrls ?? [],
    environmentImageUrls: options.environmentImageUrls ?? [],
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
  // 用户在 Gate 1 显式选过的口播语言优先 —— 这是决定 LLM 生成的 scriptText / scene.voiceLine /
  // dialogue / sellingPoints 用什么语言写的真源。
  // 没选时回退到 HTTP 请求头的浏览器界面语言（旧行为）。这里同时决定下游 veo-3.1 native_audio
  // 口播语言 —— 因为 veo-3.1 按 voiceLine 字面的语言生成音频。
  const planLocale: 'zh' | 'en' = input.voiceLanguage ?? (input.locale === 'zh' ? 'zh' : 'en');

  const { plan, breakdown, targetProductName, targetProductCategory } = await buildPlanForJob({
    reference: job.reference,
    video,
    productImageUrls: job.productImageUrls,
    environmentImageUrls: job.environmentImageUrls,
    creatorImageCount: job.creatorImageUrls.length,
    locale: planLocale,
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
    reference: applyTargetProductToReference(job.reference, {
      productName: targetProductName,
      category: targetProductCategory,
    }),
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

  const sceneIndexes = job.outputs.scenes.map((scene) => scene.sceneIndex);
  if (sceneIndexes.length > 0) {
    await repository.clearSceneOutputFields(input.jobId, input.ownerId, sceneIndexes, [
      'videoUrl',
      'voiceUrl',
      'mixUrl',
    ]);
  }
  await repository.clearOutputFields(input.jobId, input.ownerId, ['bgmUrl', 'finalUrl']);

  const updated = await repository.updateJob(input.jobId, input.ownerId, {
    gate2ConfirmedAt: new Date(),
  });
  if (!updated) return null;

  return getRemakeJobView(input.jobId, input.ownerId);
}

// ============================================================
// 单场参数编辑（视频阶段）
// ============================================================

export async function updateSceneParams(input: {
  jobId: string;
  ownerId: string;
  sceneIndex: number;
  action?: string;
  dialogue?: string;
  voiceLine?: string;
  imagePrompt?: string | null;
  videoPrompt?: string | null;
}): Promise<RemakeJobView | null> {
  const repository = await getRemakeJobRepository();
  const job = await repository.getJob(input.jobId, input.ownerId);
  if (!job) return null;

  const tasks = await repository.listTasksByJob(input.jobId);
  const statuses = deriveJobStageStatuses(job, tasks);

  // 编辑 imagePrompt 只需要 storyboard 未锁；编辑视频字段时仍要求 video 阶段可访问。
  const touchesVideoOnly =
    input.action !== undefined ||
    input.dialogue !== undefined ||
    input.voiceLine !== undefined ||
    input.videoPrompt !== undefined;
  const touchesImageOnly = input.imagePrompt !== undefined;

  if (touchesVideoOnly && statuses.video === 'locked') {
    throw new Error('Video stage is locked. Confirm storyboards first.');
  }
  if (touchesImageOnly && statuses.storyboard === 'locked') {
    throw new Error('Storyboard stage is locked. Confirm creator/product lock first.');
  }

  const sceneExists = job.plan.scenes.some((scene) => scene.index === input.sceneIndex);
  if (!sceneExists) {
    throw new Error(`Scene ${input.sceneIndex} not found.`);
  }

  const updated = await repository.patchScenePlan(input.jobId, input.ownerId, input.sceneIndex, {
    ...(input.action !== undefined ? { action: input.action } : {}),
    ...(input.dialogue !== undefined ? { dialogue: input.dialogue } : {}),
    ...(input.voiceLine !== undefined ? { voiceLine: input.voiceLine } : {}),
    ...(input.imagePrompt !== undefined ? { imagePrompt: input.imagePrompt } : {}),
    ...(input.videoPrompt !== undefined ? { videoPrompt: input.videoPrompt } : {}),
  });
  if (!updated) return null;

  return getRemakeJobView(input.jobId, input.ownerId);
}

// ============================================================
// 全局 prompt 覆盖（lock / bgm / environment）
// ============================================================

/**
 * 更新 plan 上的"全局 prompt 覆盖"。覆盖只影响下一次 stage 触发，不会自动重跑。
 *
 * - creatorPrompt / productPrompt / bgmPrompt：lock + video 阶段读
 * - environmentPrompts[i]：lock 阶段的环境锁定 task 读
 *
 * 任意字段传 null / 空串 = 清除覆盖回到自动生成；undefined = 不动。
 */
export async function updatePlanPrompts(input: {
  jobId: string;
  ownerId: string;
  creatorPrompt?: string | null;
  productPrompt?: string | null;
  bgmPrompt?: string | null;
  environmentPrompts?: Array<{ environmentIndex: number; prompt: string | null }>;
}): Promise<RemakeJobView | null> {
  const repository = await getRemakeJobRepository();
  const job = await repository.getJob(input.jobId, input.ownerId);
  if (!job) return null;

  if (input.environmentPrompts?.length) {
    const validIndexes = new Set(job.plan.environments.map((env) => env.index));
    for (const entry of input.environmentPrompts) {
      if (!validIndexes.has(entry.environmentIndex)) {
        throw new Error(`Environment ${entry.environmentIndex} not found.`);
      }
    }
  }

  const updated = await repository.patchPlanPrompts(input.jobId, input.ownerId, {
    ...(input.creatorPrompt !== undefined ? { creatorPrompt: input.creatorPrompt } : {}),
    ...(input.productPrompt !== undefined ? { productPrompt: input.productPrompt } : {}),
    ...(input.bgmPrompt !== undefined ? { bgmPrompt: input.bgmPrompt } : {}),
    ...(input.environmentPrompts?.length ? { environmentPrompts: input.environmentPrompts } : {}),
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
    planned = expandLockStage(job, { sliceKeys: input.sliceKeys });
  } else if (input.stage === 'storyboard') {
    planned = await expandStoryboardStage(job, { sliceKeys: input.sliceKeys });
  } else if (input.stage === 'video') {
    planned = await expandVideoStage(job, { sliceKeys: input.sliceKeys });
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

  if (input.stage === 'video') {
    const sceneIndexes = planned
      .map((task) => {
        const sliceKey = task.sliceKey;
        const match = /^scene-video-(\d+)$/.exec(sliceKey);
        return match ? Number(match[1]) : null;
      })
      .filter((value): value is number => value !== null);
    if (sceneIndexes.length > 0) {
      await repository.clearSceneOutputFields(input.jobId, input.ownerId, sceneIndexes, [
        'videoUrl',
      ]);
    }

    await repository.deleteTasksByStages(input.jobId, ['final']);
    await repository.clearOutputFields(input.jobId, input.ownerId, [
      ...(planned.some((task) => task.sliceKey === SliceKeys.bgm) ? (['bgmUrl'] as const) : []),
      'finalUrl',
    ]);
    await repository.updateJob(input.jobId, input.ownerId, {
      stagePatch: {
        name: 'final',
        state: { status: 'ready' },
      },
    });
  }

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

function applyTargetProductToReference(
  reference: RemakeReference,
  target: { productName?: string; category?: string },
): RemakeReference {
  const productName = target.productName?.trim();
  if (!productName) return reference;
  return {
    ...reference,
    productName,
    ...(target.category?.trim() ? { category: target.category.trim() } : {}),
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
      ...(scene.environmentIndex ? { environmentIndex: scene.environmentIndex } : {}),
    })),
    sellingPoints: plan.sellingPoints,
    audienceTags: plan.audienceTags,
    ...(plan.creatorPrompt ? { creatorPrompt: plan.creatorPrompt } : {}),
    ...(plan.productPrompt ? { productPrompt: plan.productPrompt } : {}),
    ...(plan.bgmPrompt ? { bgmPrompt: plan.bgmPrompt } : {}),
    ...(plan.sceneImagePrompts ? { sceneImagePrompts: plan.sceneImagePrompts } : {}),
    ...(plan.sceneVideoPrompts ? { sceneVideoPrompts: plan.sceneVideoPrompts } : {}),
    ...(plan.voice ? { voice: plan.voice } : {}),
    ...(plan.character ? { character: plan.character } : {}),
    environments: plan.environments,
    sceneEnvironmentMap: plan.sceneEnvironmentMap,
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
