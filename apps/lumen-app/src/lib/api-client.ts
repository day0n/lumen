type TokenGetter = () => Promise<string | null>;

type CachedApiResponse = {
  body: string;
  expiresAt: number;
  headers: [string, string][];
  status: number;
  statusText: string;
};

let installed = false;
let tokenGetter: TokenGetter | null = null;
const apiCache = new Map<string, CachedApiResponse>();

const apiCacheTtlByPath: Array<[prefix: string, ttlMs: number]> = [
  ['/api/home/featured', 30 * 60_000],
  ['/api/home/templates', 30 * 60_000],
  ['/api/projects/', 5 * 60_000],
  ['/api/projects', 60_000],
  ['/api/material-assets', 5 * 60_000],
  ['/api/folders', 5 * 60_000],
  ['/api/hot-videos', 30 * 60_000],
  ['/api/tiktok-dashboard', 60_000],
  ['/api/me', 60_000],
];

export function setApiTokenGetter(getter: TokenGetter | null) {
  tokenGetter = getter;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const request = normalizeRequest(input, init);
  if (!request.headers.has('Authorization')) {
    const token = await readApiToken();
    if (token) request.headers.set('Authorization', `Bearer ${token}`);
  }
  request.headers.set('x-lumen-locale', readLocale());
  return fetch(request);
}

export function installApiFetchInterceptor() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const apiUrl = readSameOriginApiUrl(input);
    if (!apiUrl) return nativeFetch(input, init);

    const request = normalizeRequest(input, init);
    const method = request.method.toUpperCase();
    const skipToken = request.headers.has('Authorization') || isCanvasUploadRequest(apiUrl, method);
    const token = skipToken ? null : await readApiToken();
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    if (!request.headers.has('x-lumen-locale')) {
      request.headers.set('x-lumen-locale', readLocale());
    }

    if (method === 'GET') {
      const cached = readCachedApiResponse(apiUrl, request.headers);
      if (cached) return cached;
    }

    const response = await nativeFetch(request);
    if (
      (response.status === 401 || response.status === 403) &&
      !isPrefetchRequest(request) &&
      !isCanvasUploadRequest(apiUrl, method)
    ) {
      const redirectUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.assign(`/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`);
    }
    if (method === 'GET') {
      void writeCachedApiResponse(apiUrl, request.headers, response);
    } else if (response.ok) {
      clearApiCacheForMutation(apiUrl.pathname);
    }
    return response;
  };
}

async function readApiToken(timeoutMs = 1500): Promise<string | null> {
  if (!tokenGetter) return null;

  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeout = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    return await Promise.race([tokenGetter().catch(() => null), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function isPrefetchRequest(request: Request) {
  return request.headers.get('x-lumen-prefetch') === '1';
}

function isCanvasUploadRequest(url: URL, method: string) {
  return method === 'POST' && url.pathname === '/api/canvas/uploads';
}

function normalizeRequest(input: RequestInfo | URL, init: RequestInit) {
  const request = new Request(input, init);
  return new Request(request, {
    headers: new Headers(request.headers),
  });
}

function readSameOriginApiUrl(input: RequestInfo | URL): URL | null {
  const raw = input instanceof Request ? input.url : input.toString();
  const url = new URL(raw, window.location.origin);
  if (url.origin !== window.location.origin || !url.pathname.startsWith('/api/')) return null;
  return url;
}

function readLocale() {
  if (typeof document === 'undefined') return 'en';
  const cookieLocale = document.cookie
    .split(';')
    .map((part) => part.trim())
    .find((part) => part.startsWith('lumen_locale='))
    ?.split('=')[1];
  return cookieLocale === 'zh' ? 'zh' : 'en';
}

function readCachedApiResponse(url: URL, headers: Headers) {
  const key = apiCacheKey(url, headers);
  const cached = apiCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    apiCache.delete(key);
    return null;
  }
  return new Response(cached.body, {
    status: cached.status,
    statusText: cached.statusText,
    headers: cached.headers,
  });
}

async function writeCachedApiResponse(url: URL, headers: Headers, response: Response) {
  if (!response.ok) return;
  const ttlMs = ttlForApiPath(url.pathname);
  if (!ttlMs) return;
  const cloned = response.clone();
  const contentType = cloned.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) return;
  const body = await cloned.text();
  apiCache.set(apiCacheKey(url, headers), {
    body,
    expiresAt: Date.now() + ttlMs,
    headers: Array.from(cloned.headers.entries()),
    status: cloned.status,
    statusText: cloned.statusText,
  });
}

function ttlForApiPath(pathname: string) {
  return (
    apiCacheTtlByPath.find(([prefix]) => pathname === prefix || pathname.startsWith(prefix))?.[1] ??
    0
  );
}

function apiCacheKey(url: URL, headers: Headers) {
  return `${headers.get('authorization') ?? 'anon'}|${headers.get('x-lumen-locale') ?? 'en'}|${url.pathname}${url.search}`;
}

function clearApiCacheForMutation(pathname: string) {
  const projectTouched =
    pathname.startsWith('/api/projects') ||
    pathname.startsWith('/api/folders') ||
    (pathname.startsWith('/api/home/templates/') && pathname.endsWith('/clone'));
  const materialTouched = pathname.startsWith('/api/material-assets');
  for (const key of apiCache.keys()) {
    if (projectTouched && (key.includes('|/api/projects') || key.includes('|/api/folders'))) {
      apiCache.delete(key);
    } else if (materialTouched && key.includes('|/api/material-assets')) {
      apiCache.delete(key);
    }
  }
}
