import { requireStudioUser } from '@/server/auth';
import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { getRemakeJobView } from '@/server/remake/jobs';

export const runtime = 'nodejs';
export const maxDuration = 30;

export const GET = withApiRouteSpan(
  'GET /api/remake/jobs/[id]',
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const locale = resolveRequestLocale(request);
    try {
      const { id } = await context.params;
      const user = await requireStudioUser();
      const view = await getRemakeJobView(id, user.id);
      if (!view) {
        return failJson(locale === 'zh' ? '复刻任务不存在' : 'Remake job not found', 404);
      }
      return okJson(view);
    } catch (error) {
      return routeError(error, locale);
    }
  },
);
