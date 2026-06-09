import { failJson, routeError, withApiRouteSpan } from '@/server/http';
import { getR2Settings } from '@/server/objectStorage';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const R2_PUBLIC_HOST_PATTERN = /^pub-[a-z0-9]+\.r2\.dev$/i;
const VIDEO_PATH_PATTERN = /\.(mp4|webm|mov|m4v)$/i;

export const GET = withApiRouteSpan('GET /api/hot-videos/media', async (request: Request) =>
  proxyMedia(request, 'GET'),
);

export const HEAD = withApiRouteSpan('HEAD /api/hot-videos/media', async (request: Request) =>
  proxyMedia(request, 'HEAD'),
);

async function proxyMedia(request: Request, method: 'GET' | 'HEAD'): Promise<Response> {
  try {
    const requestUrl = new URL(request.url);
    const rawUrl = requestUrl.searchParams.get('url');
    const target = parseAllowedMediaUrl(rawUrl);
    if (!target) return failJson('Invalid media URL', 400);

    const upstream = await fetch(target, {
      method,
      redirect: 'follow',
      headers: buildUpstreamHeaders(request),
      signal: AbortSignal.timeout(180_000),
    });

    if (!upstream.ok && upstream.status !== 304) {
      // Drain the upstream body to free the socket before returning.
      try {
        await upstream.body?.cancel();
      } catch {
        // ignore
      }
      return failJson('Media unavailable', upstream.status);
    }

    const body = method === 'HEAD' || upstream.status === 304 ? null : (upstream.body ?? null);

    return new Response(body, {
      status: upstream.status,
      headers: buildResponseHeaders(upstream),
    });
  } catch (error) {
    return routeError(error);
  }
}

function parseAllowedMediaUrl(value: string | null): URL | null {
  if (!value) return null;

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') return null;
  if (!VIDEO_PATH_PATTERN.test(url.pathname)) return null;

  if (R2_PUBLIC_HOST_PATTERN.test(url.hostname)) return url;

  const settings = getR2Settings();
  if (!settings) return null;

  try {
    const publicBase = new URL(settings.publicBaseUrl);
    if (url.hostname === publicBase.hostname) return url;
  } catch {
    return null;
  }

  return null;
}

function buildUpstreamHeaders(request: Request): HeadersInit {
  const headers: Record<string, string> = {
    accept: request.headers.get('accept') ?? '*/*',
  };

  const range = request.headers.get('range');
  if (range) headers.range = range;

  const ifNoneMatch = request.headers.get('if-none-match');
  if (ifNoneMatch) headers['if-none-match'] = ifNoneMatch;

  const ifModifiedSince = request.headers.get('if-modified-since');
  if (ifModifiedSince) headers['if-modified-since'] = ifModifiedSince;

  return headers;
}

function buildResponseHeaders(upstream: Response): Headers {
  const headers = new Headers();
  for (const name of [
    'content-type',
    'content-length',
    'content-range',
    'accept-ranges',
    'etag',
    'last-modified',
  ]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }

  headers.set('cache-control', 'public, max-age=86400');
  return headers;
}
