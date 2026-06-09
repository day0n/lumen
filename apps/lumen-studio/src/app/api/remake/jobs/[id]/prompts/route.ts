import { requireStudioUser } from '@/server/auth';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { updatePlanPrompts } from '@/server/remake/jobs';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 30;

/**
 * PATCH /api/remake/jobs/[id]/prompts
 *
 * 编辑 plan 上的"全局 prompt 覆盖"。任意字段：
 * - 字符串 → 写入覆盖
 * - null  → 清除覆盖，回退到自动生成
 * - undefined / 缺省 → 不动
 *
 * 单场（scene-image-N / scene-video-N）的 prompt 走 scenes/[sceneIndex]
 * 的 PATCH（imagePrompt / videoPrompt 字段），本路由不重复覆盖它们。
 */

const EnvironmentPromptSchema = z
  .object({
    environmentIndex: z.number().int().min(1),
    prompt: z.string().trim().max(4000).nullable(),
  })
  .strict();

const Body = z
  .object({
    creatorPrompt: z.string().trim().max(4000).nullable().optional(),
    productPrompt: z.string().trim().max(4000).nullable().optional(),
    bgmPrompt: z.string().trim().max(4000).nullable().optional(),
    environmentPrompts: z.array(EnvironmentPromptSchema).max(8).optional(),
  })
  .strict()
  .refine(
    (value) =>
      value.creatorPrompt !== undefined ||
      value.productPrompt !== undefined ||
      value.bgmPrompt !== undefined ||
      (value.environmentPrompts?.length ?? 0) > 0,
    { message: 'At least one prompt field must be provided.' },
  );

export const PATCH = withApiRouteSpan(
  'PATCH /api/remake/jobs/[id]/prompts',
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const locale = resolveRequestLocale(request);
    try {
      const { id } = await context.params;
      const body = Body.parse(await readJson(request));
      const user = await requireStudioUser();
      const view = await updatePlanPrompts({
        jobId: id,
        ownerId: user.id,
        ...(body.creatorPrompt !== undefined ? { creatorPrompt: body.creatorPrompt } : {}),
        ...(body.productPrompt !== undefined ? { productPrompt: body.productPrompt } : {}),
        ...(body.bgmPrompt !== undefined ? { bgmPrompt: body.bgmPrompt } : {}),
        ...(body.environmentPrompts ? { environmentPrompts: body.environmentPrompts } : {}),
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
      if (error instanceof Error && error.message.startsWith('Environment ')) {
        return failJson(error.message, 404);
      }
      return routeError(error, locale);
    }
  },
);
