import { translate } from '@/i18n/messages';
import { requireStudioUser } from '@/server/auth';
import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { isProbeUrlAllowed, probeRemoteMediaDuration } from '@/server/media-probe';

export const runtime = 'nodejs';

export const GET = withApiRouteSpan('GET /api/media/probe', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    await requireStudioUser();
    const { searchParams } = new URL(request.url);
    const url = searchParams.get('url')?.trim();
    const projectId = searchParams.get('projectId')?.trim() || null;

    if (!url) {
      return failJson(translate(locale, 'api.invalidRequest'), 400);
    }

    const allowed = await isProbeUrlAllowed(url, projectId);
    if (!allowed) {
      return failJson('URL is not allowed for probing', 403);
    }

    const duration = await probeRemoteMediaDuration(url);
    return okJson({ duration });
  } catch (error) {
    return routeError(error, locale);
  }
});
