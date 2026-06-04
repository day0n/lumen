import { requireStudioUser } from '@/server/auth';
import { GeminiNotConfiguredError, generateGeminiText } from '@/server/gemini';
import { getHotVideo } from '@/server/hotVideos';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { ensureStudioSystemFolder } from '@/server/projectFolders';
import { createStudioProject } from '@/server/projects';
import { type HotVideoRecord, ProjectCanvasSchema } from '@lumen/db';
import { type RemakeScene, buildRemakeCanvas, remakeRunBoundaries } from '@lumen/shared/domain';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 200;

const ReferenceSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1).max(180),
    value: z.string().trim().min(1).max(500),
    source: z.enum(['link', 'video']),
  })
  .strict();

const RemakeBodySchema = z
  .object({
    videoId: z.string().trim().min(1).optional(),
    reference: ReferenceSchema.optional(),
    productImageUrls: z.array(z.string().trim().url()).min(1).max(9),
    prompt: z.string().trim().max(1200).optional(),
    settings: z
      .object({
        aspectRatio: z.string().trim().optional(),
        resolution: z.string().trim().optional(),
        language: z.string().trim().optional(),
        // 用户在前端选择的目标总时长（秒），仅作为 LLM 提示，不强制分镜数量。
        duration: z.number().int().min(5).max(120).optional(),
        // 兼容旧版字段，不再使用但保留以免老客户端报错。
        mode: z.string().trim().optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

interface RemakePlan {
  scriptText: string;
  scenes: RemakeScene[];
  sellingPoints: string[];
  audienceTags: string[];
  creatorPrompt?: string;
  productPrompt?: string;
  sceneImagePrompts?: string[];
  sceneVideoPrompts?: string[];
  bgmPrompt?: string;
}

export const POST = withApiRouteSpan('POST /api/hot-videos/remake', async (request: Request) => {
  const requestLocale = resolveRequestLocale(request);
  try {
    const body = RemakeBodySchema.parse(await readJson(request));
    await requireStudioUser();
    // 文案语言以用户在配置弹窗中选的为准；没选则回退请求头 locale。
    const copyLocale: 'en' | 'zh' =
      body.settings?.language === 'zh' || body.settings?.language === 'en'
        ? body.settings.language
        : requestLocale;
    const video = body.videoId ? await getHotVideo(body.videoId, copyLocale) : null;

    if (body.videoId && !video) {
      return failJson(copyLocale === 'zh' ? '爆款视频不存在' : 'Viral video not found', 404);
    }

    const reference = body.reference ?? makeReferenceFromVideo(video);
    const fallbackPlan = buildFallbackPlan({
      video,
      reference,
      prompt: body.prompt,
      locale: copyLocale,
    });
    const generatedPlan = await tryGenerateRemakePlan({
      video,
      reference,
      prompt: body.prompt,
      productImageCount: body.productImageUrls.length,
      locale: copyLocale,
      targetDurationSeconds: body.settings?.duration,
    });
    const plan = normalizePlan(generatedPlan, fallbackPlan);
    const canvas = buildRemakeCanvas({
      scriptText: plan.scriptText,
      scenes: plan.scenes,
      productImageUrls: body.productImageUrls,
      ...(plan.creatorPrompt ? { creatorPrompt: plan.creatorPrompt } : {}),
      ...(plan.productPrompt ? { productPrompt: plan.productPrompt } : {}),
      ...(plan.sceneImagePrompts ? { sceneImagePrompts: plan.sceneImagePrompts } : {}),
      ...(plan.sceneVideoPrompts ? { sceneVideoPrompts: plan.sceneVideoPrompts } : {}),
      ...(plan.bgmPrompt ? { bgmPrompt: plan.bgmPrompt } : {}),
      settings: {
        aspectRatio: body.settings?.aspectRatio || '9:16',
        resolution: normalizeResolution(body.settings?.resolution),
      },
    });
    const viralRemixFolder = await ensureStudioSystemFolder('viral_remix');
    const project = await createStudioProject({
      title: `${copyLocale === 'zh' ? '爆款复刻' : 'Viral remix'} - ${reference.label}`,
      description:
        copyLocale === 'zh'
          ? '隐藏画布：由爆款复刻页面驱动的后台工作流'
          : 'Hidden canvas: backend workflow driven by the viral remix page',
      ...(video?.thumbnailUrl ? { thumbnail: video.thumbnailUrl } : {}),
      folderId: viralRemixFolder.id,
      canvas: ProjectCanvasSchema.parse(canvas),
    });

    return okJson({
      projectId: project.id,
      ownerId: project.ownerId,
      reference: {
        id: reference.id,
        label: reference.label,
        value: reference.value,
        source: reference.source,
        title: video?.title ?? reference.label,
        productName: video?.productName ?? reference.label,
        category: video?.category,
        region: video?.region,
        thumbnailUrl: video?.thumbnailUrl,
        previewUrl: video?.previewUrl,
        hook: video?.analysis.hook,
        angle: video?.analysis.angle,
        structure: video?.analysis.structure ?? plan.scenes.map((scene) => scene.action),
      },
      canvas,
      scenes: plan.scenes,
      scriptText: plan.scriptText,
      sellingPoints: plan.sellingPoints,
      audienceTags: plan.audienceTags,
      boundaries: remakeRunBoundaries(plan.scenes),
      productImageUrls: body.productImageUrls,
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return failJson(requestLocale === 'zh' ? '请求 JSON 无效' : 'Invalid JSON', 400);
    }
    return routeError(error, requestLocale);
  }
});

function normalizeResolution(value: string | undefined): '720p' | '1080p' {
  return value === '1080p' ? '1080p' : '720p';
}

function makeReferenceFromVideo(video: HotVideoRecord | null): z.infer<typeof ReferenceSchema> {
  if (video) {
    return {
      id: video.id,
      label: video.productName,
      value: video.sourceUrl ?? video.title,
      source: 'video',
    };
  }
  return {
    id: 'manual-reference',
    label: 'Reference video',
    value: 'Manual reference',
    source: 'link',
  };
}

async function tryGenerateRemakePlan(input: {
  video: HotVideoRecord | null;
  reference: z.infer<typeof ReferenceSchema>;
  prompt?: string;
  productImageCount: number;
  locale: 'en' | 'zh';
  targetDurationSeconds?: number;
}): Promise<Partial<RemakePlan> | null> {
  try {
    const text = await generateGeminiText(buildGeminiPrompt(input));
    const parsed = parseJsonObject(text);
    return parsed ? (parsed as Partial<RemakePlan>) : null;
  } catch (error) {
    if (error instanceof GeminiNotConfiguredError) return null;
    console.warn('[hot-videos/remake] Gemini plan generation failed', error);
    return null;
  }
}

function buildGeminiPrompt(input: {
  video: HotVideoRecord | null;
  reference: z.infer<typeof ReferenceSchema>;
  prompt?: string;
  productImageCount: number;
  locale: 'en' | 'zh';
  targetDurationSeconds?: number;
}): string {
  const video = input.video;
  const product = video?.productName ?? input.reference.label;
  return `
You are building a deterministic "one-click viral product replication" plan for Lumen.

Important workflow:
1. Break down the reference.
2. Produce the script and wait for Gate 1 confirmation.
3. Lock creator identity and product appearance.
4. Produce 3-6 storyboard keyframes and wait for Gate 2 confirmation.
5. Generate per-scene videos and Suno BGM.
6. Final deterministic edit: full-film BGM, trim every clip by 0.2s, fast flash transitions, unified subtitles.

Do not invent a canvas. Return only JSON for the hidden workflow builder.
Use 3 to 6 scenes. Keep every scene suitable for 3s or 6s video generation.

Reference:
- Title: ${video?.title ?? input.reference.value}
- Product: ${product}
- Category: ${video?.category ?? 'unknown'}
- Region: ${video?.region ?? 'unknown'}
- Hook: ${video?.analysis.hook ?? ''}
- Angle: ${video?.analysis.angle ?? ''}
- Structure: ${(video?.analysis.structure ?? []).join(' | ')}
- User product/request notes: ${input.prompt ?? ''}
- Uploaded product image count: ${input.productImageCount}
- Output language: ${input.locale === 'zh' ? 'Chinese' : 'English'}
- Target total video length: ${input.targetDurationSeconds ? `~${input.targetDurationSeconds}s (pick scene count and per-scene duration so the sum lands near this)` : 'flexible'}

Return this exact JSON shape, no markdown:
{
  "scriptText": "full script users can review at Gate 1",
  "sellingPoints": ["3 to 5 product selling points"],
  "audienceTags": ["2 to 5 audience tags"],
  "creatorPrompt": "photorealistic creator identity lock prompt",
  "productPrompt": "product multi-view lock prompt using uploaded product images",
  "bgmPrompt": "instrumental Suno music prompt, no vocals",
  "scenes": [
    {"index": 1, "action": "shot action", "dialogue": "subtitle or voice line", "durationSeconds": 4, "camera": "camera / framing (durationSeconds must be one of 4, 6, 8)"}
  ],
  "sceneImagePrompts": ["one image prompt per scene, matching scenes order"],
  "sceneVideoPrompts": ["one video prompt per scene, matching scenes order"]
}
`.trim();
}

function buildFallbackPlan(input: {
  video: HotVideoRecord | null;
  reference: z.infer<typeof ReferenceSchema>;
  prompt?: string;
  locale: 'en' | 'zh';
}): RemakePlan {
  const product = input.video?.productName ?? input.reference.label;
  const hook =
    input.video?.analysis.hook ??
    (input.locale === 'zh'
      ? '先展示结果，再解释产品价值'
      : 'Show the result first, then explain the product value');
  const angle =
    input.video?.analysis.angle ??
    (input.locale === 'zh'
      ? '真实用户体验 + 快速效果展示'
      : 'Real-user experience plus quick effect reveal');
  const structure = normalizeStructure(input.video?.analysis.structure, input.locale);
  const durations = durationPattern(structure.length);
  const scenes = structure.map((item, index) => {
    const sceneNumber = index + 1;
    const zh = input.locale === 'zh';
    return {
      index: sceneNumber,
      action: zh
        ? `${item}。围绕用户上传商品图中的 ${product} 做真实带货演示`
        : `${item}. Demonstrate ${product} from the uploaded product images in an authentic UGC style`,
      dialogue: zh
        ? fallbackChineseLine(sceneNumber, product, hook, angle)
        : fallbackEnglishLine(sceneNumber, product, hook, angle),
      durationSeconds: durations[index] ?? 4,
      camera: cameraForIndex(index),
    };
  });

  const scriptText = [
    input.locale === 'zh'
      ? `复刻目标：${input.reference.value}`
      : `Remix target: ${input.reference.value}`,
    input.locale === 'zh' ? `爆点：${hook}` : `Hook: ${hook}`,
    input.locale === 'zh' ? `角度：${angle}` : `Angle: ${angle}`,
    input.prompt
      ? input.locale === 'zh'
        ? `用户补充：${input.prompt}`
        : `User notes: ${input.prompt}`
      : '',
    '',
    ...scenes.map((scene) =>
      input.locale === 'zh'
        ? `${scene.index}. ${scene.action}\n   台词：${scene.dialogue}\n   运镜：${scene.camera}`
        : `${scene.index}. ${scene.action}\n   Line: ${scene.dialogue}\n   Camera: ${scene.camera}`,
    ),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    scriptText,
    scenes,
    sellingPoints:
      input.locale === 'zh'
        ? ['结果先行', '真实上手', '痛点对比', '快速转化']
        : ['Result first', 'Real hands-on demo', 'Pain-point contrast', 'Fast conversion'],
    audienceTags:
      input.locale === 'zh'
        ? ['TikTok Shop 买家', '价格敏感用户', '效果导向用户']
        : ['TikTok Shop buyers', 'Value seekers', 'Result-driven shoppers'],
    creatorPrompt:
      'Photorealistic UGC creator identity reference sheet, natural skin, consistent face, neutral background, standing pose, close-up face, hand demonstration pose.',
    productPrompt: `Create a crisp multi-view reference sheet for the uploaded ${product} product image: front, side, three-quarter, detail macro. Preserve exact shape, color, material, and branding.`,
    bgmPrompt:
      'Instrumental modern TikTok Shop product ad music, clean upbeat luxury feel, no vocals, steady rhythm, suitable for UGC product demonstration.',
    sceneImagePrompts: scenes.map(
      (scene) =>
        `Storyboard keyframe for scene ${scene.index}. ${scene.action}. Camera: ${scene.camera}. Keep the locked creator and locked product consistent. Photorealistic vertical UGC frame.`,
    ),
    sceneVideoPrompts: scenes.map(
      (scene) =>
        `Scene ${scene.index}, ${scene.durationSeconds}s. ${scene.action}. Camera: ${scene.camera}. Subtitle/line: ${scene.dialogue}. Smooth natural UGC motion, product remains visually consistent.`,
    ),
  };
}

function normalizePlan(generated: Partial<RemakePlan> | null, fallback: RemakePlan): RemakePlan {
  const scenes = normalizeScenes(generated?.scenes, fallback.scenes);
  return {
    scriptText: readString(generated?.scriptText) ?? fallback.scriptText,
    scenes,
    sellingPoints: normalizeStringArray(generated?.sellingPoints, fallback.sellingPoints, 5),
    audienceTags: normalizeStringArray(generated?.audienceTags, fallback.audienceTags, 5),
    creatorPrompt: readString(generated?.creatorPrompt) ?? fallback.creatorPrompt,
    productPrompt: readString(generated?.productPrompt) ?? fallback.productPrompt,
    bgmPrompt: readString(generated?.bgmPrompt) ?? fallback.bgmPrompt,
    sceneImagePrompts: normalizePromptArray(
      generated?.sceneImagePrompts,
      fallback.sceneImagePrompts,
      scenes.length,
    ),
    sceneVideoPrompts: normalizePromptArray(
      generated?.sceneVideoPrompts,
      fallback.sceneVideoPrompts,
      scenes.length,
    ),
  };
}

function normalizeScenes(value: unknown, fallback: RemakeScene[]): RemakeScene[] {
  if (!Array.isArray(value)) return fallback;
  const rawScenes = value
    .map((item, index) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const action = readString(record.action);
      const dialogue = readString(record.dialogue);
      const camera = readString(record.camera);
      if (!action || !dialogue || !camera) return null;
      const rawDuration =
        typeof record.durationSeconds === 'number' && Number.isFinite(record.durationSeconds)
          ? record.durationSeconds
          : 4;
      // veo-3.1 仅支持 [4, 6, 8] 秒，吸附到最近的合法值。
      const supportedDurations = [4, 6, 8];
      const durationSeconds = supportedDurations.find((value) => value >= rawDuration) ?? 8;
      return {
        index: index + 1,
        action,
        dialogue,
        durationSeconds,
        camera,
      };
    })
    .filter((item): item is RemakeScene => Boolean(item))
    .slice(0, 6);
  return rawScenes.length >= 3 ? rawScenes : fallback;
}

function normalizeStructure(value: string[] | undefined, locale: 'en' | 'zh'): string[] {
  const cleaned = (value ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (cleaned.length >= 3) return cleaned;
  return locale === 'zh'
    ? ['结果先行开场', '痛点和产品对比', '上手演示细节', '价格/场景强化', '转化收口']
    : [
        'Result-first opening',
        'Pain point and product contrast',
        'Hands-on detail demo',
        'Value or use-case reinforcement',
        'Conversion close',
      ];
}

function durationPattern(count: number): number[] {
  // veo-3.1 仅支持 [4, 6, 8] 秒，骨架尽量用 4s 短切镜 + 6s 重点镜的节奏。
  if (count <= 3) return [4, 6, 6].slice(0, count);
  if (count === 4) return [4, 4, 4, 6];
  return Array.from({ length: count }, () => 4);
}

function cameraForIndex(index: number): string {
  const cameras = [
    'tight handheld close-up, result visible immediately',
    'medium shot, creator demonstrates the product naturally',
    'macro detail shot, hands show texture and key feature',
    'quick pan-up reveal, product stays centered',
    'stable front-facing testimonial shot',
    'final close-up with product and call-to-action',
  ];
  return cameras[index] ?? cameras[cameras.length - 1]!;
}

function fallbackChineseLine(scene: number, product: string, hook: string, angle: string): string {
  const lines = [
    `你先看这个效果，${product} 的重点就是 ${hook}`,
    '我最在意的是它能不能真的解决这个痛点，答案是可以',
    '这里看细节，质感和使用方式都很清楚',
    `${angle}，所以日常使用会更稳定`,
    '想要同款效果的话，直接看这个产品就行',
    '最后再看一遍结果，重点是真的省事',
  ];
  return lines[scene - 1] ?? lines[0]!;
}

function fallbackEnglishLine(scene: number, product: string, hook: string, angle: string): string {
  const lines = [
    `Look at the result first. The point of ${product} is ${hook}.`,
    'I wanted to know if it actually solves the problem, and it does.',
    'Here is the detail: the texture and the way it works are clear.',
    `${angle}, so it feels easier to use every day.`,
    'If you want the same effect, this is the product to check.',
    'One last look at the result. It is simple and practical.',
  ];
  return lines[scene - 1] ?? lines[0]!;
}

function normalizeStringArray(value: unknown, fallback: string[], max: number): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, max);
  return cleaned.length ? cleaned : fallback;
}

function normalizePromptArray(
  value: unknown,
  fallback: string[] | undefined,
  expectedLength: number,
): string[] | undefined {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, expectedLength);
  if (cleaned.length !== expectedLength) return fallback;
  return cleaned;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenced?.[1] ?? trimmed) as Record<string, unknown>;
}
