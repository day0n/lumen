// 勿加 server-only：server.ts 经 eventMirror/taskOutcome 在进程启动时加载本模块。
import type {
  RemakeJobEnvironment,
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
  images: [],
  video: null,
  videos: [],
  audio: null,
  audios: [],
  clips: [],
};

const FINAL_CLIP_HEAD_TRIM_SECONDS = 0.2;
const DEFAULT_BGM_BRIEF =
  'Instrumental luxury UGC product ad background music, modern, clean, upbeat but not distracting, no vocals, suitable for a vertical social product video.';

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
  environmentLock: (index: number) => `environment-lock-${index}`,
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

export function parseEnvironmentIndexFromSliceKey(sliceKey: string): number | null {
  const match = /^environment-lock-(\d+)$/.exec(sliceKey);
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
  | 'environmentLockUrl'
  | 'bgmUrl'
  | 'finalUrl'
  | null {
  if (sliceKey === SliceKeys.creatorLock) return 'creatorLockUrl';
  if (sliceKey === SliceKeys.productLock) return 'productLockUrl';
  if (sliceKey.startsWith('environment-lock-')) return 'environmentLockUrl';
  if (sliceKey === SliceKeys.bgm) return 'bgmUrl';
  if (sliceKey === SliceKeys.final) return 'finalUrl';
  if (sliceKey.startsWith('scene-image-')) return 'imageUrl';
  if (sliceKey.startsWith('scene-video-')) return 'videoUrl';
  if (sliceKey.startsWith('scene-voice-')) return 'voiceUrl';
  if (sliceKey.startsWith('scene-mix-')) return 'mixUrl';
  return null;
}

// ============================================================
// Lock stage：创作者锁定 + 产品锁定 + 环境锁定
// ============================================================

export function expandLockStage(job: RemakeJobRecord): PlannedTask[] {
  const aspectRatio = job.settings.aspectRatio;
  const [creator0, creator1] = job.creatorImageUrls;
  const [product0, product1] = job.productImageUrls;
  const productName = job.reference.productName ?? job.reference.label;
  const environments = planEnvironments(job);

  const creatorPrompt =
    job.plan.creatorPrompt ??
    (creator0
      ? 'A clean multi-view character reference sheet of the uploaded creator: standing pose, close-up face, hand demonstration pose. Preserve the exact face, hair, body shape, skin tone, and overall style from the reference image. Photorealistic, natural lighting, neutral background. Consistent identity across all panels.'
      : 'A clean multi-view character reference sheet of a relatable UGC creator, photorealistic, natural skin and lighting, neutral background. Three rows: standing poses, facial expressions, action poses. Consistent identity across all panels.');

  const productPrompt =
    job.plan.productPrompt ??
    (product0
      ? 'A clean multi-view product reference sheet of the uploaded product on a plain white background: front, side, and three-quarter angles. Preserve the exact product shape, color, material and branding from the reference image. Studio lighting, crisp focus.'
      : `A clean multi-view product reference sheet for "${productName}" on a plain white background: front, side, and three-quarter angles. Use the product description and campaign script as the source of truth. Studio lighting, crisp focus, realistic UGC commerce product asset.`);

  const tasks: PlannedTask[] = [
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
        images: compactRefs(job.creatorImageUrls.slice(0, 2)),
      }),
      settings: { aspectRatio },
    },
    {
      stage: 'lock',
      sliceKey: SliceKeys.productLock,
      handler: 'nano-banana2',
      input: makeInput({
        prompt: productPrompt,
        // Same multi-image reference mode as above. Keep image/lastFrameImage for
        // legacy consumers while images[] carries the full reference set.
        image: product0 ?? null,
        lastFrameImage: product1 ?? null,
        images: compactRefs(job.productImageUrls.slice(0, 4)),
      }),
      settings: { aspectRatio },
    },
  ];

  for (const environment of environments) {
    const sourceImage = job.environmentImageUrls[environment.index - 1] ?? null;
    const overridePrompt = environment.prompt?.trim();
    tasks.push({
      stage: 'lock',
      sliceKey: SliceKeys.environmentLock(environment.index),
      handler: 'nano-banana2',
      input: makeInput({
        // 用户对该环境锁定 prompt 显式 override 优先；否则用 buildEnvironmentLockPrompt
        // 按是否有参考图自动生成"附图模式"或"纯文字模式"的 prompt。
        prompt: overridePrompt || buildEnvironmentLockPrompt(environment, Boolean(sourceImage)),
        image: sourceImage,
        lastFrameImage: null,
        images: compactRefs(sourceImage ? [sourceImage] : []),
      }),
      settings: { aspectRatio },
    });
  }

  return tasks;
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
  const environments = planEnvironments(job);

  const prompts = await Promise.all(
    job.plan.scenes.map((scene) => {
      const environmentIndex =
        scene.environmentIndex ?? job.plan.sceneEnvironmentMap[String(scene.index)] ?? 1;
      const environment =
        environments.find((item) => item.index === environmentIndex) ?? environments[0];
      const environmentLockUrl = findEnvironmentLockUrl(job, environment?.index ?? 1);
      return generateStoryboardPrompt({
        scene,
        character: job.plan.character,
        productName,
        environment,
        creatorLockUrl: creatorLock,
        productLockUrl: productLock,
        environmentLockUrl,
        aspectRatio,
      });
    }),
  );

  return job.plan.scenes.map((scene, i) => {
    const generated = prompts[i];
    const overridePrompt = job.plan.sceneImagePrompts?.[i]?.trim();
    // Fallback：不描述实体视觉细节，只用 token 引用。
    const characterToken = `@${(job.plan.character?.name ?? 'creator').replace(/\s+/g, '_')}`;
    const productToken = `@${productName.toLowerCase().replace(/\s+/g, '-')}`;
    const environmentIndex =
      scene.environmentIndex ?? job.plan.sceneEnvironmentMap[String(scene.index)] ?? 1;
    const environment =
      environments.find((item) => item.index === environmentIndex) ?? environments[0];
    const environmentToken = `@${(environment?.name ?? 'main-environment')
      .toLowerCase()
      .replace(/\s+/g, '-')}`;
    const environmentLockUrl = findEnvironmentLockUrl(job, environment?.index ?? 1);
    const refs = compactRefs([creatorLock, productLock, environmentLockUrl]);
    const fallback = `First-frame keyframe for Scene ${scene.index}. ${characterToken} performs the action: ${scene.action} inside ${environmentToken}. Camera: ${scene.camera}. ${productToken} is positioned naturally in the shot. Photorealistic UGC, vertical ${aspectRatio} composition. The reference images attached define ${characterToken}, ${productToken}, and ${environmentToken} — do not invent their appearance.`;

    return {
      stage: 'storyboard',
      sliceKey: SliceKeys.sceneImage(scene.index),
      handler: 'nano-banana2',
      input: makeInput({
        // 优先级：用户 override > Gemini 看 lock 图动态生成 > 兜底硬编码 fallback
        prompt: overridePrompt || generated || fallback,
        // 多图角色顺序与 promptGenerators.ts 保持一致：
        // Image 1 = creator, Image 2 = product, Image 3 = environment。
        image: creatorLock,
        lastFrameImage: productLock,
        images: refs,
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
  const bgmDurationSeconds = estimateFinalDurationSeconds(job);

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
    const promptOverride = job.plan.sceneVideoPrompts?.[i]?.trim();
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
        prompt: promptOverride || generated || fallback,
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
      prompt: buildBgmPrompt(job, bgmDurationSeconds),
    }),
    settings: { instrumental: true, suno_model: 'V5', durationSeconds: bgmDurationSeconds },
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
      trimHeadSeconds: FINAL_CLIP_HEAD_TRIM_SECONDS,
      flashTransition: true,
      renderSubtitles: true,
      // 视频自带口播音轨保留为主声道（默认 1）；BGM 压低到 0.28 当背景。
      bgmVolume: 0.28,
      clipTitles,
    },
  };
}

export function estimateFinalDurationSeconds(job: RemakeJobRecord): number {
  return job.plan.scenes.reduce((sum, scene) => {
    const duration = Number(scene.durationSeconds);
    if (!Number.isFinite(duration) || duration <= 0) return sum;
    return sum + Math.max(0.1, duration - FINAL_CLIP_HEAD_TRIM_SECONDS);
  }, 0);
}

export function buildBgmPrompt(job: RemakeJobRecord, targetDurationSeconds: number): string {
  const duration = Math.max(1, targetDurationSeconds);
  const sceneCount = Math.max(1, job.plan.scenes.length);
  const averageSeconds = duration / sceneCount;
  const sceneLabel = sceneCount === 1 ? 'scene' : 'scenes';
  const brief = job.plan.bgmPrompt?.trim() || DEFAULT_BGM_BRIEF;

  return [
    'Generate one continuous instrumental BGM track for the final editing stage of this short product video.',
    'No vocals, no lyrics, no spoken words.',
    `Target duration: ${formatPromptSeconds(duration)} seconds; a short extra tail is okay because editing will trim the track.`,
    `Average scene duration: ${formatPromptSeconds(averageSeconds)} seconds across ${sceneCount} ${sceneLabel}. Choose a BPM and phrase structure that let scene cuts land on strong beats or 4/8-beat phrase boundaries.`,
    'Keep the intro fast enough for short-form editing, with a clean loop-friendly ending.',
    `Music brief: ${brief}`,
  ].join('\n');
}

function formatPromptSeconds(value: number): string {
  return Math.max(0, value).toFixed(1).replace(/\.0$/, '');
}

function buildEnvironmentLockPrompt(
  environment: RemakeJobEnvironment,
  hasReferenceImage: boolean,
): string {
  const referenceRule = hasReferenceImage
    ? 'The attached location image defines the actual spatial identity. Preserve its layout, camera direction, lighting logic, surfaces, and mood. Do NOT add people, hands, products, subtitles, UI text, or logos.'
    : 'Generate this reusable space from the description. Do NOT add people, hands, products, subtitles, UI text, or logos.';

  return `Create a reusable 2x2 multi-scale ENVIRONMENT reference plate for UGC video remaking.

Environment token: @${environment.name.replace(/\s+/g, '-')}
Environment description: ${environment.description}
Used by scenes: ${environment.usedSceneIndexes.join(', ')}

${referenceRule}

Grid structure:
- Top-left: wide establishing view of the full space and spatial depth.
- Top-right: medium framing of the main action zone.
- Bottom-left: close-up of the surface / object area where hands or product demos can happen later.
- Bottom-right: alternate tight composition from the SAME hero angle.

All four panels must depict the SAME physical environment from the SAME hero camera direction. Only framing scale changes. Photorealistic real-life UGC texture, natural exposure, coherent lighting.`;
}

function planEnvironments(job: RemakeJobRecord): RemakeJobEnvironment[] {
  if (job.plan.environments.length > 0) return job.plan.environments;
  return [
    {
      index: 1,
      name: 'Main UGC space',
      description:
        'Reusable lived-in UGC shooting space with natural light for creator talking beats, product demos, and detail close-ups.',
      usedSceneIndexes: job.plan.scenes.map((scene) => scene.index),
    },
  ];
}

function findEnvironmentLockUrl(job: RemakeJobRecord, environmentIndex: number): string | null {
  return (
    job.outputs.environmentLocks.find((item) => item.environmentIndex === environmentIndex)
      ?.imageUrl ?? null
  );
}

function compactRefs(values: Array<string | null | undefined>): string[] {
  const refs: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed && !refs.includes(trimmed)) refs.push(trimmed);
  }
  return refs;
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
  const videoGated: RemakeStageStatus = storyboardGated !== 'success' ? 'locked' : videoComputed;

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
