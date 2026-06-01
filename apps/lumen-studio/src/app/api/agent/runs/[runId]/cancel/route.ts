/**
 * 取消一个 run（透传到 lumen-agent）。
 */

import { requireStudioUser } from '@/server/auth';
import { getStudioServerConfig } from '@/server/config';
import { failJson, okJson, routeError } from '@/server/http';

export const runtime = 'nodejs';

interface CancelRunContext {
  params: Promise<{ runId: string }>;
}

export async function POST(_request: Request, context: CancelRunContext) {
  try {
    await requireStudioUser();
  } catch (error) {
    return routeError(error);
  }

  const { runId } = await context.params;
  if (!runId) return failJson('runId is required', 400);

  const config = getStudioServerConfig();

  try {
    const upstream = await fetch(
      `${config.LUMEN_AGENT_URL}/v1/agent/runs/${encodeURIComponent(runId)}/cancel`,
      { method: 'POST' },
    );
    const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    if (!upstream.ok) {
      return failJson(`agent 返回 ${upstream.status}`, upstream.status, data);
    }
    return okJson(data);
  } catch (error) {
    return failJson(`无法连接 agent 服务: ${(error as Error).message}`, 502);
  }
}
