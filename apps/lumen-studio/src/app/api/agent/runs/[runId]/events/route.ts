/**
 * 拉取一个 run 的 SSE 事件流（透传到 lumen-agent）。
 *
 * - 透传 Last-Event-ID 头实现断线续传。
 * - 直接转发 ReadableStream，不在中间层解析 SSE。
 */

import { requireStudioUser } from '@/server/auth';
import { getStudioServerConfig } from '@/server/config';
import { failJson, routeError } from '@/server/http';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RunEventsContext {
  params: Promise<{ runId: string }>;
}

export async function GET(request: Request, context: RunEventsContext) {
  try {
    await requireStudioUser();
  } catch (error) {
    return routeError(error);
  }

  const { runId } = await context.params;
  if (!runId) return failJson('runId is required', 400);

  const config = getStudioServerConfig();

  const controller = new AbortController();
  request.signal.addEventListener('abort', () => controller.abort(), { once: true });

  const headers: Record<string, string> = { accept: 'text/event-stream' };
  const lastEventId = request.headers.get('last-event-id');
  if (lastEventId) headers['last-event-id'] = lastEventId;

  let upstream: Response;
  try {
    upstream = await fetch(
      `${config.LUMEN_AGENT_URL}/v1/agent/runs/${encodeURIComponent(runId)}/events`,
      {
        method: 'GET',
        headers,
        signal: controller.signal,
      },
    );
  } catch (error) {
    return failJson(`无法连接 agent 服务: ${(error as Error).message}`, 502);
  }

  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return failJson(text || `agent 返回 ${upstream.status}`, upstream.status);
  }

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
