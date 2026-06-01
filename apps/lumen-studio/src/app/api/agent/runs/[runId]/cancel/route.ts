/**
 * 取消一个 run（透传到 lumen-agent）。
 */

import { requireStudioUser } from '@/server/auth';
import { getStudioServerConfig } from '@/server/config';
import { failJson, okJson, routeError } from '@/server/http';
import { translate } from '@/i18n/messages';
import { resolveRequestLocale } from '@/server/locale';

export const runtime = 'nodejs';

interface CancelRunContext {
  params: Promise<{ runId: string }>;
}

export async function POST(request: Request, context: CancelRunContext) {
  const locale = resolveRequestLocale(request);
  try {
    await requireStudioUser();
  } catch (error) {
    return routeError(error, locale);
  }

  const { runId } = await context.params;
  if (!runId) return failJson(translate(locale, 'api.runIdRequired'), 400);

  const config = getStudioServerConfig();

  try {
    const upstream = await fetch(
      `${config.LUMEN_AGENT_URL}/v1/agent/runs/${encodeURIComponent(runId)}/cancel`,
      { method: 'POST', headers: { 'x-lumen-locale': locale } },
    );
    const data = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
    if (!upstream.ok) {
      return failJson(
        translate(locale, 'api.agentReturned', { status: upstream.status }),
        upstream.status,
        data,
      );
    }
    return okJson(data);
  } catch (error) {
    return failJson(
      translate(locale, 'api.agentConnectionFailed', { message: (error as Error).message }),
      502,
    );
  }
}
