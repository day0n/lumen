// 勿加 server-only：由 jobs.ts 在 server.ts 启动链上加载。
import type {
  RemakeJobRecord,
  RemakeJobSceneOutput,
  RemakeStageName,
  RemakeStageStatus,
  RemakeTaskHandler,
  RemakeTaskInput,
  RemakeTaskRecord,
} from '@lumen/db';

import { generateStoryboardPrompt, generateVideoPrompt } from './promptGenerators';

/**
 * Stage → Task 展开逻辑（纯函数）。
 *
 * 这里是爆款复刻流水线"为什么不是 DAG"的实现核心：
 * - 拓扑写死在代码里（每个 expand* 都是确定性的）
 * - Task 数量随 plan.scenes 动态（2 场就生 2 个 scene-image task）
 * - sliceKey 是 (job, slice) 维度的稳定标识，replan / retry 时同 slice 会被原地覆盖
 *
 * Engine remake-consumer 不需要懂 stage 概念，它只看 task.handler + task.input + task.settings。
 */

export interface PlannedTask {
  stage: RemakeStageName;
  sliceKey: string;
  handler: RemakeTaskHandler;
  input: RemakeTaskInput;
  settings: Record<string, unknown>;
}

const EMPTY_INPUT: RemakeTaskInput = {
  prompt: '',
  image: null,
  lastFrameImage: null,
  video: null,
  videos: [],
  audio: null,
  audios: [],
  clips: [],
};

function makeInput(patch: Partial<RemakeTaskInput>): RemakeTaskInput {
  return { ...EMPTY_INPUT, ...patch };
}

// ============================================================
// SliceKey 约定
// ============================================================
// 这些 key 必须稳定可解析 —— stages.ts 在这里定义，jobs.ts 在 task 完成时按 key
// 把 outputUrl 映射回 job.outputs 的正确字段。

export const SliceKeys = {
  creatorLock: 'creator-lock',
  productLock: 'product-lock',
  sceneImage: (index: number) => `scene-image-${index}`,
  sceneVideo: (index: number) => `scene-video-${index}`,
  sceneVoice: (index: number) => `scene-voice-${index}`,
  sceneMix: (index: number) => `scene-mix-${index}`,
  bgm: 'bgm',
  final: 'final-cut',
} as const;

/** 解析 sliceKey 拿场次号（scene-image-3 → 3）；非场次 slice 返回 null。 */
export function parseSceneIndexFromSliceKey(sliceKey: string): number | null {
  const match = /^scene-(?:image|video|voice|mix)-(\d+)$/.exec(sliceKey);
  if (!match) return null;
  const n = Number.parseInt(match[1]!, 10);
  return Number.isFinite(n) && n >= 1 ? n : null;
}

/** sliceKey → 它落到 job.outputs.scenes[i] 的哪个字段。 */
export function sliceOutputField(
  sliceKey: string,
):
  | keyof Omit<RemakeJobSceneOutput, 'sceneIndex'>
  | 'creatorLockUrl'
  | 'productLockUrl'
  | 'bgmUrl'
  | 'finalUrl'
  | null {
  if (sliceKey === SliceKeys.creatorLock) return 'creatorLockUrl';
  if (sliceKey === SliceKeys.productLock) return 'productLockUrl';
  if (sliceKey === SliceKeys.bgm) return 'bgmUrl';
  if (sliceKey === SliceKeys.final) return 'finalUrl';
  if (sliceKey.startsWith('scene-image-')) return 'imageUrl';
  if (sliceKey.startsWith('scene-video-')) return 'videoUrl';
  if (sliceKey.startsWith('scene-voice-')) return 'voiceUrl';
  if (sliceKey.startsWith('scene-mix-')) return 'mixUrl';
  return null;
}

// ============================================================
// Lock stage：创作者锁定 + 产品锁定
// ============================================================

export function expandLockStage(job: RemakeJobRecord): PlannedTask[] {
  const aspectRatio = job.settings.aspectRatio;
  const [creator0, creator1] = job.creatorImageUrls;
  const [product0, product1] = job.productImageUrls;

  const creatorPrompt =
    job.plan.creatorPrompt ??
    (creator0
      ? 'A clean multi-view character reference sheet of the uploaded creator: standing pose, close-up face, hand demonstration pose. Preserve the exact face, hair, body shape, skin tone, and overall style from the reference image. Photorealistic, natural lighting, neutral background. Consistent identity across all panels.'
      : 'A clean multi-view character reference sheet of a relatable UGC creator, photorealistic, natural skin and lighting, neutral background. Three rows: standing poses, facial expressions, action poses. Consistent identity across all panels.');

  const productPrompt =
    job.plan.productPrompt ??
    'A clean multi-view product reference sheet of the uploaded product on a plain white background: front, side, and three-quarter angles. Preserve the exact product shape, color, material and branding from the reference image. Studio lighting, crisp focus.';

  return [
    {
      stage: 'lock',
      sliceKey: SliceKeys.creatorLock,
      handler: 'nano-banana2',
      input: makeInput({
        prompt: creatorPrompt,
        // Multi-image reference mode (NOT first/last-frame i2v):
        // nano-banana2 iterates [image, lastFrameImage] and sends both as inline
        // reference parts to Gemini. This is intentional — two creator photos give
        // the model more angles to lock identity. Do NOT interpret these as video frames.
        image: creator0 ?? null,
        lastFrameImage: creator1 ?? null,
      }),
      settings: { aspectRatio },
    },
    {
      stage: 'lock',
      sliceKey: SliceKeys.productLock,
      handler: 'nano-banana2',
      input: makeInput({
        prompt: productPrompt,
        // Same multi-image reference mode as above — up to 2 product photos.
        // product0/product1 are the first two uploaded product images; the rest are
        // not passed because nano-banana2 only reads image + lastFrameImage.
        image: product0 ?? null,
        lastFrameImage: product1 ?? null,
      }),
      settings: { aspectRatio },
    },
  ];
}

// ============================================================
// Storyboard stage：每场首帧分镜（i2i，喂 lock 输出 + 脚本）
// 改 async：在派发任务前用 Gemini 多模态"看着 lock 图"生成具体的分镜 prompt。
// ============================================================

export async function expandStoryboardStage(job: RemakeJobRecord): Promise<PlannedTask[]> {
  const aspectRatio = job.settings.aspectRatio;
  const creatorLock = job.outputs.creatorLockUrl ?? null;
  const productLock = job.outputs.productLockUrl ?? null;

  const prompts = await Promise.all(
    job.plan.scenes.map((scene) =>
      generateStoryboardPrompt({
        scene,
        character: job.plan.character,
        creatorLockUrl: creatorLock,
        productLockUrl: productLock,
        aspectRatio,
      }),
    ),
  );

  return job.plan.scenes.map((scene, i) => {
    const generated = prompts[i];
    const fallback = `First-frame keyframe of Scene ${scene.index}. ${scene.action}. Camera: ${scene.camera}. Feature the locked creator holding/wearing the locked product; keep their identity and the product's appearance consistent with the reference images. ${aspectRatio} vertical composition, photorealistic UGC look.`;

    return {
      stage: 'storyboard',
      sliceKey: SliceKeys.sceneImage(scene.index),
      handler: 'nano-banana2',
      input: makeInput({
        prompt: generated ?? fallback,
        image: creatorLock,
        lastFrameImage: productLock,
      }),
      settings: { aspectRatio },
    };
  });
}

// ============================================================
// Video stage：每场视频 (i2v 喂分镜首帧) + 每场 TTS 口播 + 全片 BGM
// scene-mix 不在这里展开，因为它依赖 scene-video + scene-voice 完成后才能跑，
// 由 jobs.ts 在 video stage 内某场两个输入齐了时自动 enqueue。
// 改 async：在派发任务前用 Gemini 多模态"看着分镜首帧"生成具体的视频 prompt。
// ============================================================

export async function expandVideoStage(job: RemakeJobRecord): Promise<PlannedTask[]> {
  const aspectRatio = job.settings.aspectRatio;
  const videoResolution = '720p'; // veo-3.1 约束：720p 才尊重 per-scene duration
  const voice = job.plan.voice ?? pickDefaultVoice(job.plan.scriptText, job.settings.language);

  const generatedVideoPrompts = await Promise.all(
    job.plan.scenes.map((scene) => {
      const sceneImageUrl = job.outputs.scenes.find(
        (entry) => entry.sceneIndex === scene.index,
      )?.imageUrl;
      return generateVideoPrompt({
        scene,
        character: job.plan.character,
        storyboardUrl: sceneImageUrl ?? null,
        aspectRatio,
      });
    }),
  );

  const tasks: PlannedTask[] = [];

  for (const [i, scene] of job.plan.scenes.entries()) {
    const generated = generatedVideoPrompts[i];
    const sceneImageOutput = job.outputs.scenes.find(
      (entry) => entry.sceneIndex === scene.index,
    )?.imageUrl;

    const character = job.plan.character;
    const characterName = character?.name?.trim() || 'Speaker';
    const characterGender = character?.gender ?? 'unspecified';
    const characterAge = character?.ageRange ?? 'adult';
    const characterTone = character?.tone ?? 'natural UGC tone';
    const voiceLine = (scene.voiceLine ?? scene.dialogue ?? '').trim();

    // Fallback 也按 标准 UGC 语法写死（@Name (VO, gender) says）以保留口型同步信号。
    const fallback = `Continue motion from the attached first-frame keyframe. Keep creator identity and product appearance stable. Scene ${scene.index}, ~${scene.durationSeconds}s. Action: ${scene.action}. Camera: ${scene.camera}. Speaker voice: @${characterName} — ${characterGender}, ${characterAge}, ${characterTone}. @${characterName} (VO, ${characterGender}) says: "${voiceLine}". Audio will be replaced in post; the on-screen mouth shapes must match the spoken line above.`;

    tasks.push({
      stage: 'video',
      sliceKey: SliceKeys.sceneVideo(scene.index),
      handler: 'veo-3.1',
      input: makeInput({
        prompt: generated ?? fallback,
        image: sceneImageOutput ?? null,
      }),
      settings: {
        aspectRatio,
        resolution: videoResolution,
        duration: scene.durationSeconds,
      },
    });

    tasks.push({
      stage: 'video',
      sliceKey: SliceKeys.sceneVoice(scene.index),
      handler: 'fish-tts',
      input: makeInput({ prompt: voiceLine }),
      settings: { voice },
    });
  }

  // 全片 BGM 跟视频/口播并行，挂在同一个 stage 内
  tasks.push({
    stage: 'video',
    sliceKey: SliceKeys.bgm,
    handler: 'suno-music',
    input: makeInput({
      prompt:
        job.plan.bgmPrompt ??
        'Instrumental luxury UGC product ad background music, modern, clean, upbeat but not distracting, no vocals, suitable for a vertical TikTok Shop product video.',
    }),
    settings: { instrumental: true, suno_model: 'V5' },
  });

  return tasks;
}

/**
 * 单场 scene-mix 的展开 —— 由 jobs.ts 在该场 video+voice 都 success 时调用。
 * 不在 expandVideoStage 里一次性返回，是因为它的 input 字段要 wait 那两个上游的 outputUrl。
 */
export function planSceneMixTask(job: RemakeJobRecord, sceneIndex: number): PlannedTask | null {
  const sceneOutput = job.outputs.scenes.find((entry) => entry.sceneIndex === sceneIndex);
  if (!sceneOutput?.videoUrl || !sceneOutput.voiceUrl) return null;
  const scene = job.plan.scenes.find((s) => s.index === sceneIndex);
  if (!scene) return null;

  return {
    stage: 'video', // mix 仍归在 video stage 内（UI 把视频/口播/混音视为同一阶段）
    sliceKey: SliceKeys.sceneMix(sceneIndex),
    handler: 'lumen-video-edit',
    input: makeInput({
      video: sceneOutput.videoUrl,
      videos: [sceneOutput.videoUrl],
      audio: sceneOutput.voiceUrl,
      audios: [sceneOutput.voiceUrl],
      clips: [{ url: sceneOutput.videoUrl, title: scene.dialogue }],
    }),
    settings: {
      aspectRatio: job.settings.aspectRatio,
      resolution: '720p',
      // 静音 veo 自带音轨，只播 TTS 口播
      defaultClipVolume: 0,
      bgmVolume: 1,
      trimHeadSeconds: 0,
      flashTransition: false,
      renderSubtitles: false,
    },
  };
}

// ============================================================
// Final stage：拼场景混音 + 叠 BGM + 字幕快闪
// ============================================================

export function expandFinalStage(job: RemakeJobRecord): PlannedTask | null {
  // 必须所有场次 mix 都齐 + bgm 齐才能跑
  const orderedMixUrls: string[] = [];
  for (const scene of job.plan.scenes) {
    const url = job.outputs.scenes.find((entry) => entry.sceneIndex === scene.index)?.mixUrl;
    if (!url) return null;
    orderedMixUrls.push(url);
  }
  const bgm = job.outputs.bgmUrl;
  if (!bgm) return null;

  const clipTitles = job.plan.scenes.map((scene) => scene.dialogue).filter(Boolean);

  return {
    stage: 'final',
    sliceKey: SliceKeys.final,
    handler: 'lumen-video-edit',
    input: makeInput({
      videos: orderedMixUrls,
      clips: orderedMixUrls.map((url, i) => ({
        url,
        ...(clipTitles[i] ? { title: clipTitles[i]! } : {}),
      })),
      audio: bgm,
      audios: [bgm],
    }),
    settings: {
      aspectRatio: job.settings.aspectRatio,
      resolution: job.settings.resolution,
      trimHeadSeconds: 0.2,
      flashTransition: true,
      renderSubtitles: true,
      bgmVolume: 0.28,
      clipTitles,
    },
  };
}

// ============================================================
// Stage 状态推导（纯函数）
// ============================================================

/**
 * 给定某 stage 当前所有 task 状态，推导 stage 应该是什么状态。
 * 调用方传入的 tasks 应已被 stage 过滤。
 */
export function deriveStageStatus(tasks: RemakeTaskRecord[]): RemakeStageStatus {
  if (tasks.length === 0) return 'ready';
  let anyRunning = false;
  let anyError = false;
  let anyCancelled = false;
  let allSuccess = true;
  for (const task of tasks) {
    if (task.status === 'queued' || task.status === 'running') {
      anyRunning = true;
      allSuccess = false;
    } else if (task.status === 'error') {
      anyError = true;
      allSuccess = false;
    } else if (task.status === 'cancelled') {
      anyCancelled = true;
      allSuccess = false;
    }
  }
  if (anyRunning) return 'running';
  if (allSuccess) return 'success';
  if (anyError) return 'error';
  if (anyCancelled) return 'cancelled';
  return 'ready';
}

/**
 * 给定整个 job + 所有 task，返回每个 stage 的"应有"状态（按门控规则）。
 * 这是 UI stepper 的真源，UI 不需要自己推。
 */
export function deriveJobStageStatuses(
  job: RemakeJobRecord,
  tasks: RemakeTaskRecord[],
): Record<RemakeStageName, RemakeStageStatus> {
  const byStage = new Map<RemakeStageName, RemakeTaskRecord[]>();
  for (const task of tasks) {
    const list = byStage.get(task.stage) ?? [];
    list.push(task);
    byStage.set(task.stage, list);
  }
  const tasksOf = (stage: RemakeStageName) => byStage.get(stage) ?? [];

  const breakdown: RemakeStageStatus = 'success';
  const script: RemakeStageStatus = job.gate1ConfirmedAt ? 'success' : 'ready';

  const lockTasks = tasksOf('lock');
  const lockStatus = lockTasks.length > 0 ? deriveStageStatus(lockTasks) : 'ready';
  const lock: RemakeStageStatus = job.gate1ConfirmedAt ? lockStatus : 'locked';

  const storyboardTasks = tasksOf('storyboard');
  const storyboardComputed =
    storyboardTasks.length > 0 ? deriveStageStatus(storyboardTasks) : 'ready';
  const storyboardGated: RemakeStageStatus =
    lock !== 'success' ? 'locked' : job.gate2ConfirmedAt ? 'success' : storyboardComputed;

  const videoTasks = tasksOf('video');
  const videoComputed = videoTasks.length > 0 ? deriveStageStatus(videoTasks) : 'ready';
  // video stage 还需要 mix 全部 success 才能算 success
  const videoGated: RemakeStageStatus =
    storyboardGated !== 'success' ? 'locked' : videoFullStatus(job, videoTasks, videoComputed);

  const finalTasks = tasksOf('final');
  const finalComputed = finalTasks.length > 0 ? deriveStageStatus(finalTasks) : 'ready';
  const final: RemakeStageStatus = videoGated !== 'success' ? 'locked' : finalComputed;

  return {
    breakdown,
    script,
    lock,
    storyboard: storyboardGated,
    video: videoGated,
    final,
  };
}

function videoFullStatus(
  job: RemakeJobRecord,
  videoTasks: RemakeTaskRecord[],
  computed: RemakeStageStatus,
): RemakeStageStatus {
  if (computed !== 'success') return computed;
  // computed=success 意味着已 dispatch 的 task 全 success，但 mix 可能还没全部生出来
  const expectedMixCount = job.plan.scenes.length;
  const mixSuccessCount = videoTasks.filter(
    (task) => task.sliceKey.startsWith('scene-mix-') && task.status === 'success',
  ).length;
  return mixSuccessCount >= expectedMixCount ? 'success' : 'running';
}

// ============================================================
// 工具：默认声线（与 buildRemakeCanvas 历史行为一致）
// ============================================================

function pickDefaultVoice(scriptText: string, language: 'zh' | 'en'): string {
  if (language === 'zh') return 'AD_Sister';
  if (language === 'en') return 'Rachel';
  return /[\u4e00-\u9fff]/.test(scriptText) ? 'AD_Sister' : 'Rachel';
}
