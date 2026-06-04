import { requireStudioUser } from '@/server/auth';
import { failJson, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { getRemakeJobView } from '@/server/remake/jobs';
import { openRemakeSseStream } from '@/server/remake/sse';

export const runtime = 'nodejs';
// SSE 不需要超时，保持长连接到客户端 disconnect
export const dynamic = 'force-dynamic';

export const GET = withApiRouteSpan(
  'GET /api/remake/jobs/[id]/stream',
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const locale = resolveRequestLocale(request);
    const { id } = await context.params;
    const user = await requireStudioUser();

    // 权限校验：必须能拿到 job 才能订阅其事件
    const view = await getRemakeJobView(id, user.id);
    if (!view) {
      return failJson(locale === 'zh' ? '复刻任务不存在' : 'Remake job not found', 404);
    }

    const lastEventId = request.headers.get('last-event-id') ?? undefined;
    return openRemakeSseStream({
      jobId: id,
      lastEventId,
      signal: request.signal,
    });
  },
);
