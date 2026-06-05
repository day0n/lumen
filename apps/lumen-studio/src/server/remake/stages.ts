// 勿加 server-only：server.ts 经 eventMirror/taskOutcome 在进程启动时加载本模块。
import type {
  RemakeJobRecord,
  RemakeJobSceneOutput,
  RemakeStageName,
  RemakeStageStatus,
  RemakeTaskHandler,
  RemakeTaskInput,
  RemakeTaskRecord,
} from '@lumen/db';

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
  const { generateStoryboardPrompt } = await import('./promptGenerators');
  const aspectRatio = job.settings.aspectRatio;
  const creatorLock = job.outputs.creatorLockUrl ?? null;
  const productLock = job.outputs.productLockUrl ?? null;
  const productName = job.reference.productName ?? job.reference.label;

  const prompts = await Promise.all(
    job.plan.scenes.map((scene) =>
      generateStoryboardPrompt({
        scene,
        character: job.plan.character,
        productName,
        creatorLockUrl: creatorLock,
        productLockUrl: productLock,
        aspectRatio,
      }),
    ),
  );

  return job.plan.scenes.map((scene, i) => {
    const generated = prompts[i];
    // Fallback：不描述实体视觉细节，只用 token 引用。
    const characterToken = `@${(job.plan.character?.name ?? 'creator').replace(/\s+/g, '_')}`;
    const productToken = `@${productName.toLowerCase().replace(/\s+/g, '-')}`;
    const fallback = `First-frame keyframe for Scene ${scene.index}. ${characterToken} performs the action: ${scene.action}. Camera: ${scene.camera}. ${productToken} is positioned naturally in the shot. Photorealistic UGC, vertical ${aspectRatio} composition. The reference images attached define the appearance of ${characterToken} and ${productToken} — do not invent appearance.`;

    return {
      stage: 'storyboard',
      sliceKey: SliceKeys.sceneImage(scene.index),
      handler: 'nano-banana2',
      input: makeInput({
        prompt: generated ?? fallback,
        // 把 product 放第一张，creator 放第二张：
        // nano-banana2 (Gemini 3 Pro Image) 对第一张图的视觉权重更高，
        // 让 product 主导避免商品被弱化。Lumen 靠位置补偿。
        image: productLock,
        lastFrameImage: creatorLock,
      }),
      settings: { aspectRatio },
    };
  });
}

// ============================================================
// Video stage：每场视频 (i2v 喂分镜首帧) + 全片 BGM
// 视频模型 (veo-3.1) 原生生成音频（包含口播），
// 不再派发独立 fish-tts task，也不需要后期 scene-mix 把 TTS 叠上去 ——
// 视频模型一次推理同时产出嘴型和对应音频，从根本上解决口型对不上的问题。
// ============================================================

export async function expandVideoStage(job: RemakeJobRecord): Promise<PlannedTask[]> {
  const { generateVideoPrompt } = await import('./promptGenerators');
  const aspectRatio = job.settings.aspectRatio;
  const videoResolution = '720p'; // veo-3.1 约束：720p 才尊重 per-scene duration
  const productName = job.reference.productName ?? job.reference.label;

  const generatedVideoPrompts = await Promise.all(
    job.plan.scenes.map((scene) => {
      const sceneImageUrl = job.outputs.scenes.find(
        (entry) => entry.sceneIndex === scene.index,
      )?.imageUrl;
      return generateVideoPrompt({
        scene,
        character: job.plan.character,
        productName,
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
    const characterName = character?.name?.trim() || 'creator';
    const characterToken = `@${characterName.replace(/\s+/g, '_')}`;
    const productToken = `@${productName.toLowerCase().replace(/\s+/g, '-')}`;
    const characterGender = character?.gender ?? 'unspecified';
    const characterAge = character?.ageRange ?? 'adult';
    const characterTone = character?.tone ?? 'warm friendly UGC creator';
    const voiceLine = (scene.voiceLine ?? scene.dialogue ?? '').trim();

    // Fallback 严格按统一语法（@-token + Speaker voice + (VO, gender) says）。
    // 不再描述实体视觉细节 —— @keyframe 已喂图。
    const fallback = `Continue motion forward from @keyframe. Keep ${characterToken}'s identity and ${productToken}'s appearance stable across the clip. Over ~${scene.durationSeconds}s, ${characterToken} performs: ${scene.action}. Camera: ${scene.camera}.

Speaker voice: ${characterToken} — ${characterGender}, ${characterAge}, ${characterTone}.

${characterToken} (VO, ${characterGender}) says: "${voiceLine}"

Generate the spoken audio natively in ${characterToken}'s voice. The on-screen mouth shapes must match the spoken line above.`;

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
  }

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

// ============================================================
// Final stage：直接拼每场视频（视频自带原生音轨）+ 叠 BGM + 字幕快闪
// 视频模型 native_audio 已包含口播，不再需要 scene-mix。
// ============================================================

export function expandFinalStage(job: RemakeJobRecord): PlannedTask | null {
  // 必须所有场次 video 都齐 + bgm 齐才能跑
  const orderedVideoUrls: string[] = [];
  for (const scene of job.plan.scenes) {
    const url = job.outputs.scenes.find((entry) => entry.sceneIndex === scene.index)?.videoUrl;
    if (!url) return null;
    orderedVideoUrls.push(url);
  }
  const bgm = job.outputs.bgmUrl;
  if (!bgm) return null;

  const clipTitles = job.plan.scenes.map((scene) => scene.dialogue).filter(Boolean);

  return {
    stage: 'final',
    sliceKey: SliceKeys.final,
    handler: 'lumen-video-edit',
    input: makeInput({
      videos: orderedVideoUrls,
      clips: orderedVideoUrls.map((url, i) => ({
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
      // 视频自带口播音轨保留为主声道（默认 1）；BGM 压低到 0.28 当背景。
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
    storyboardGated !== 'success' ? 'locked' : videoComputed;

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
