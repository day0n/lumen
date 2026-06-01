/**
 * 创建一个 agent run（透传到 lumen-agent）。
 *
 * Studio 在这里注入 user_id（来自 Clerk），返回 { run_id, session_id }。
 * 拿到 run_id 后客户端再走 GET /api/agent/runs/:id/events 拉 SSE。
 */

import { requireStudioUser } from '@/server/auth';
import { getStudioServerConfig } from '@/server/config';
import { failJson, okJson, routeError } from '@/server/http';
import { translate } from '@/i18n/messages';
import { resolveRequestLocale } from '@/server/locale';
import type { UserRecord } from '@lumen/db';

export const runtime = 'nodejs';

export async function POST(request: Request) {
  const locale = resolveRequestLocale(request);
  let user: UserRecord;
  try {
    user = await requireStudioUser();
  } catch (error) {
    return routeError(error, locale);
  }

  const config = getStudioServerConfig();

  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return failJson(translate(locale, 'api.invalidJson'), 400);
  }

  const upstreamBody = { ...body, user_id: user.id };

  let upstream: Response;
  try {
    upstream = await fetch(`${config.LUMEN_AGENT_URL}/v1/agent/runs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-lumen-locale': locale },
      body: JSON.stringify(upstreamBody),
    });
  } catch (error) {
    return failJson(
      translate(locale, 'api.agentConnectionFailed', { message: (error as Error).message }),
      502,
    );
  }

  const text = await upstream.text();
  let data: unknown = null;
  try {
    data = JSON.parse(text);
  } catch {
    /* tolerate non-json */
  }

  if (!upstream.ok) {
    return failJson(
      text || translate(locale, 'api.agentReturned', { status: upstream.status }),
      upstream.status,
      data,
    );
  }

  return okJson(data);
}
