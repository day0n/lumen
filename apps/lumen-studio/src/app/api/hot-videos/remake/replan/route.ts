import { requireStudioUser } from '@/server/auth';
import { getHotVideo } from '@/server/hotVideos';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { updateStudioProject } from '@/server/projects';
import { analyzeRemakeReference } from '@/server/remakeAnalysis';
import { buildFallbackPlan, normalizePlan, tryGenerateRemakePlan } from '@/server/remakePlan';
import { ProjectCanvasSchema } from '@lumen/db';
import { buildRemakeCanvas, remakeRunBoundaries } from '@lumen/shared/domain';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 200;

/**
 * Gate-1 真门控：用户在脚本面板改完脚本/卖点/受众/口播语言之后调用本接口。
 *
 * 不是只改 script 节点的 prompt 字段，而是：
 * 1. 复用已缓存的视频拆解（不重新跑 Gemini 多模态）；
 * 2. 用「用户确认的脚本」当作授权来源喂回 Gemini text plan，让 LLM 重写所有下游 prompt
 *    （voiceLine / sceneImagePrompts / sceneVideoPrompts / creatorPrompt / productPrompt / bgmPrompt）；
 * 3. 用新 plan 重建画布并 PATCH 到隐藏项目，所有节点状态回到 idle —— 用户可以再跑一遍下游。
 */

const ReferenceSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1).max(180),
    value: z.string().trim().min(1).max(500),
    source: z.enum(['link', 'video']),
  })
  .strict();

const ReplanBodySchema = z
  .object({
    projectId: z.string().trim().min(1),
    videoId: z.string().trim().min(1).optional(),
    reference: ReferenceSchema,
    productImageUrls: z.array(z.string().trim().url()).min(1).max(9),
    creatorImageUrls: z.array(z.string().trim().url()).max(2).optional(),
    prompt: z.string().trim().max(1200).optional(),
    /** 用户在 Gate 1 面板里编辑过的脚本/卖点/受众/口播语言。 */
    scriptText: z.string().trim().min(1).max(8000),
    sellingPoints: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
    audienceTags: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
    settings: z
      .object({
        aspectRatio: z.string().trim().optional(),
        resolution: z.string().trim().optional(),
        language: z.enum(['zh', 'en']).optional(),
        duration: z.number().int().min(5).max(120).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const POST = withApiRouteSpan(
  'POST /api/hot-videos/remake/replan',
  async (request: Request) => {
    const requestLocale = resolveRequestLocale(request);
    try {
      const body = ReplanBodySchema.parse(await readJson(request));
      await requireStudioUser();

      const copyLocale: 'en' | 'zh' = body.settings?.language ?? requestLocale;
      const video = body.videoId ? await getHotVideo(body.videoId, copyLocale) : null;

      const breakdown = await analyzeRemakeReference({ video, locale: copyLocale });

      const fallbackPlan = buildFallbackPlan({
        video,
        reference: body.reference,
        prompt: body.prompt,
        locale: copyLocale,
        breakdown,
      });

      const generated = await tryGenerateRemakePlan({
        video,
        reference: body.reference,
        prompt: body.prompt,
        productImageCount: body.productImageUrls.length,
        creatorImageCount: body.creatorImageUrls?.length ?? 0,
        locale: copyLocale,
        targetDurationSeconds: body.settings?.duration,
        breakdown,
        userScriptText: body.scriptText,
        userSellingPoints: body.sellingPoints,
        userAudienceTags: body.audienceTags,
      });

      const plan = normalizePlan(generated, fallbackPlan);
      // 强制把 scriptText 钉死成用户确认版（即便 LLM 想魔改）。
      plan.scriptText = body.scriptText;
      if (body.sellingPoints.length) plan.sellingPoints = body.sellingPoints;
      if (body.audienceTags.length) plan.audienceTags = body.audienceTags;

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

      const updated = await updateStudioProject(body.projectId, {
        canvas: ProjectCanvasSchema.parse(canvas),
      });
      if (!updated) {
        return failJson(copyLocale === 'zh' ? '隐藏项目不存在' : 'Hidden project not found', 404);
      }

      return okJson({
        projectId: updated.id,
        ownerId: updated.ownerId,
        reference: {
          id: body.reference.id,
          label: body.reference.label,
          value: body.reference.value,
          source: body.reference.source,
          title: video?.title ?? body.reference.label,
          productName: video?.productName ?? body.reference.label,
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
  },
);

function normalizeResolution(value: string | undefined): '720p' | '1080p' {
  return value === '1080p' ? '1080p' : '720p';
}
