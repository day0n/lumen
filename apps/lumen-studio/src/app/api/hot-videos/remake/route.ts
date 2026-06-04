import { requireStudioUser } from '@/server/auth';
import { getHotVideo } from '@/server/hotVideos';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { ensureStudioSystemFolder } from '@/server/projectFolders';
import { createStudioProject } from '@/server/projects';
import { analyzeRemakeReference } from '@/server/remakeAnalysis';
import {
  type RemakeReference,
  buildFallbackPlan,
  normalizePlan,
  tryGenerateRemakePlan,
} from '@/server/remakePlan';
import { type HotVideoRecord, ProjectCanvasSchema } from '@lumen/db';
import { buildRemakeCanvas, remakeRunBoundaries } from '@lumen/shared/domain';
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
    /** 用户上传的创作者参考图（i2i 入参，最多 2 张）。 */
    creatorImageUrls: z.array(z.string().trim().url()).max(2).optional(),
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

    const reference: RemakeReference = body.reference ?? makeReferenceFromVideo(video);

    // 1. 真拆解：先用 Gemini 看视频本体，拿到 transcript + shots。失败/没配/没视频 → null，
    //    下面的 plan 阶段仍会跑，只是回到老的文本-only 兜底路径。
    const breakdown = await analyzeRemakeReference({ video, locale: copyLocale });

    // 2. 生成执行计划（带 voiceLine、复用 breakdown 的台词节奏）
    const fallbackPlan = buildFallbackPlan({
      video,
      reference,
      prompt: body.prompt,
      locale: copyLocale,
      breakdown,
    });
    const generatedPlan = await tryGenerateRemakePlan({
      video,
      reference,
      prompt: body.prompt,
      productImageCount: body.productImageUrls.length,
      creatorImageCount: body.creatorImageUrls?.length ?? 0,
      locale: copyLocale,
      targetDurationSeconds: body.settings?.duration,
      breakdown,
    });
    const plan = normalizePlan(generatedPlan, fallbackPlan);
    const canvas = buildRemakeCanvas({
      scriptText: plan.scriptText,
      scenes: plan.scenes,
      productImageUrls: body.productImageUrls,
      ...(body.creatorImageUrls?.length ? { creatorImageUrls: body.creatorImageUrls } : {}),
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
      videoId: video?.id ?? body.videoId,
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
        hook: breakdown?.hook ?? video?.analysis.hook,
        angle: breakdown?.angle ?? video?.analysis.angle,
        structure:
          breakdown?.shots.map((shot) => shot.action) ??
          video?.analysis.structure ??
          plan.scenes.map((scene) => scene.action),
      },
      canvas,
      scenes: plan.scenes,
      scriptText: plan.scriptText,
      sellingPoints: plan.sellingPoints,
      audienceTags: plan.audienceTags,
      boundaries: remakeRunBoundaries(plan.scenes),
      productImageUrls: body.productImageUrls,
      creatorImageUrls: body.creatorImageUrls ?? [],
      breakdown: breakdown ?? null,
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

function makeReferenceFromVideo(video: HotVideoRecord | null): RemakeReference {
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
