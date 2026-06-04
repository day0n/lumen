import { requireStudioUser } from '@/server/auth';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { runStage } from '@/server/remake/jobs';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z
  .object({
    stage: z.enum(['lock', 'storyboard', 'video', 'final']),
  })
  .strict();

export const POST = withApiRouteSpan(
  'POST /api/remake/jobs/[id]/run-stage',
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const locale = resolveRequestLocale(request);
    try {
      const { id } = await context.params;
      const body = Body.parse(await readJson(request));
      const user = await requireStudioUser();
      const view = await runStage({ jobId: id, ownerId: user.id, stage: body.stage });
      if (!view) {
        return failJson(locale === 'zh' ? '复刻任务不存在' : 'Remake job not found', 404);
      }
      return okJson(view);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return failJson(locale === 'zh' ? '请求 JSON 无效' : 'Invalid JSON', 400);
      }
      if (error instanceof Error && error.message.startsWith('Stage ')) {
        return failJson(error.message, 409);
      }
      if (error instanceof Error && error.message.startsWith('Final stage')) {
        return failJson(error.message, 409);
      }
      return routeError(error, locale);
    }
  },
);
