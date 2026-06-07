import { requireStudioUser } from '@/server/auth';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { updateSceneParams } from '@/server/remake/jobs';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 30;

const Body = z
  .object({
    action: z.string().trim().min(1).max(400).optional(),
    dialogue: z.string().trim().min(1).max(400).optional(),
    voiceLine: z.string().trim().min(1).max(400).optional(),
    /** 传 null 或空串表示清除自定义视频 prompt，回退到自动生成。 */
    videoPrompt: z.string().trim().max(4000).nullable().optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.action !== undefined ||
      value.dialogue !== undefined ||
      value.voiceLine !== undefined ||
      value.videoPrompt !== undefined,
    { message: 'At least one field must be provided.' },
  );

export const PATCH = withApiRouteSpan(
  'PATCH /api/remake/jobs/[id]/scenes/[sceneIndex]',
  async (
    request: Request,
    context: { params: Promise<{ id: string; sceneIndex: string }> },
  ) => {
    const locale = resolveRequestLocale(request);
    try {
      const { id, sceneIndex: sceneIndexRaw } = await context.params;
      const sceneIndex = Number(sceneIndexRaw);
      if (!Number.isInteger(sceneIndex) || sceneIndex < 1) {
        return failJson(locale === 'zh' ? '场次序号无效' : 'Invalid scene index', 400);
      }

      const body = Body.parse(await readJson(request));
      const user = await requireStudioUser();
      const view = await updateSceneParams({
        jobId: id,
        ownerId: user.id,
        sceneIndex,
        ...(body.action !== undefined ? { action: body.action } : {}),
        ...(body.dialogue !== undefined ? { dialogue: body.dialogue } : {}),
        ...(body.voiceLine !== undefined ? { voiceLine: body.voiceLine } : {}),
        ...(body.videoPrompt !== undefined ? { videoPrompt: body.videoPrompt } : {}),
      });
      if (!view) {
        return failJson(locale === 'zh' ? '复刻任务不存在' : 'Remake job not found', 404);
      }
      return okJson(view);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return failJson(locale === 'zh' ? '请求 JSON 无效' : 'Invalid JSON', 400);
      }
      if (error instanceof Error && error.message.startsWith('Cannot edit')) {
        return failJson(error.message, 409);
      }
      if (error instanceof Error && error.message.startsWith('Video stage')) {
        return failJson(error.message, 409);
      }
      if (error instanceof Error && error.message.startsWith('Scene ')) {
        return failJson(error.message, 404);
      }
      return routeError(error, locale);
    }
  },
);
