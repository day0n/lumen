/**
 * 创建一个 agent run（透传到 lumen-agent）。
 *
 * Studio 在这里注入 user_id（来自 Clerk），返回 { run_id, session_id }。
 * 拿到 run_id 后客户端再走 GET /api/agent/runs/:id/events 拉 SSE。
 */

import { requireStudioUser } from '@/server/auth';
import { getStudioServerConfig } from '@/server/config';
import { failJson, okJson, routeError } from '@/server/http';
import type { UserRecord } from '@lumen/db';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  let user: UserRecord;
  try {
    user = await requireStudioUser();
  } catch (error) {
    return routeError(error);
  }

  const config = getStudioServerConfig();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return failJson('请求 JSON 格式不正确', 400);
  }

  const upstreamBody = { ...body, user_id: user.id };

  let upstream: Response;
  try {
    upstream = await fetch(`${config.LUMEN_AGENT_URL}/v1/agent/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(upstreamBody),
    });
  } catch (error) {
    return failJson(`无法连接 agent 服务: ${(error as Error).message}`, 502);
  }

  const text = await upstream.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* tolerate non-json */
  }

  if (!upstream.ok) {
    return failJson(text || `agent 返回 ${upstream.status}`, upstream.status, data);
  }

  return okJson(data);
}
