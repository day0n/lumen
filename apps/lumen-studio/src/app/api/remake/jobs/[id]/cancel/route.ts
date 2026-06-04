import { requireStudioUser } from '@/server/auth';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { cancelRemakeJob } from '@/server/remake/jobs';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 30;

const Body = z
  .object({
    reason: z.string().trim().max(400).optional(),
  })
  .strict()
  .optional();

export const POST = withApiRouteSpan(
  'POST /api/remake/jobs/[id]/cancel',
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const locale = resolveRequestLocale(request);
    try {
      const { id } = await context.params;
      const raw = await readJson(request).catch(() => undefined);
      const body = raw ? Body.parse(raw) : undefined;
      const user = await requireStudioUser();
      const view = await cancelRemakeJob({ jobId: id, ownerId: user.id, reason: body?.reason });
      if (!view) {
        return failJson(locale === 'zh' ? '复刻任务不存在' : 'Remake job not found', 404);
      }
      return okJson(view);
    } catch (error) {
      return routeError(error, locale);
    }
  },
);
