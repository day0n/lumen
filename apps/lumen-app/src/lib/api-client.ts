type TokenGetter = () => Promise<string | null>;
type AuthStatus = 'active' | 'signed-out' | 'unknown';
type AuthStatusVerifier = () => Promise<AuthStatus>;

export interface ApiMemoryCachePolicyInput {
  cache?: RequestCache;
  headers: Pick<Headers, 'get'>;
  pathname: string;
  searchParams?: Pick<URLSearchParams, 'get'>;
}

type CachedApiResponse = {
  body: string;
  expiresAt: number;
  headers: [string, string][];
  pathname: string;
  scopeKey: string;
  scopeKind: ApiMemoryCacheScope['kind'];
  status: number;
  statusText: string;
};

export type ApiMemoryCacheScope =
  | { kind: 'anonymous'; key: 'anonymous' }
  | { kind: 'private'; generation: number; key: string };

export interface ApiMemoryResponseCache {
  captureScope(headers: Pick<Headers, 'get'>): ApiMemoryCacheScope;
  captureVersion(): number;
  clearCanonical(url: URL, scope: ApiMemoryCacheScope): void;
  clearForMutation(pathname: string): void;
  clearPrivate(): void;
  read(url: URL, headers: Pick<Headers, 'get'>, scope: ApiMemoryCacheScope): Response | null;
  size(): number;
  write(
    url: URL,
    headers: Pick<Headers, 'get'>,
    response: Response,
    scope: ApiMemoryCacheScope,
    version: number,
  ): Promise<void>;
}

let installed = false;
let authRedirectInProgress = false;
let tokenGetter: TokenGetter | null = null;
let authStatusVerifier: AuthStatusVerifier | null = null;

const apiCacheTtlByPath: Array<[pathname: string, ttlMs: number]> = [
  ['/api/home/featured', 30 * 60_000],
  ['/api/home/templates', 30 * 60_000],
  ['/api/projects', 60_000],
  ['/api/material-assets', 5 * 60_000],
  ['/api/folders', 5 * 60_000],
  ['/api/hot-videos', 30 * 60_000],
  ['/api/me', 60_000],
];

const anonymousCacheableApiPaths = ['/api/home/featured', '/api/home/templates'];

const anonymousApiCacheScope: ApiMemoryCacheScope = {
  kind: 'anonymous',
  key: 'anonymous',
};

const apiMemoryCache = createApiMemoryResponseCache();

export function setApiTokenGetter(getter: TokenGetter | null) {
  tokenGetter = getter;
  if (!getter) clearPrivateApiMemoryCache();
}

export function clearPrivateApiMemoryCache() {
  apiMemoryCache.clearPrivate();
}

export function setApiAuthStatusVerifier(verifier: AuthStatusVerifier | null) {
  authStatusVerifier = verifier;
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
    const uploadRequest = isCanvasUploadRequest(apiUrl, method);
    const authCheckRequest = isAuthCheckRequest(request);
    const token =
      request.headers.has('Authorization') || authCheckRequest
        ? null
        : await readApiToken(uploadRequest ? 6000 : 1500);
    if (token) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    if (!request.headers.has('x-lumen-locale')) {
      request.headers.set('x-lumen-locale', readLocale());
    }
    const cacheScope = apiMemoryCache.captureScope(request.headers);
    const cacheVersion = apiMemoryCache.captureVersion();

    const useMemoryCache =
      method === 'GET' &&
      !authCheckRequest &&
      canUseApiMemoryCache({
        cache: request.cache,
        headers: request.headers,
        pathname: apiUrl.pathname,
        searchParams: apiUrl.searchParams,
      });

    if (useMemoryCache) {
      const cached = apiMemoryCache.read(apiUrl, request.headers, cacheScope);
      if (cached) return cached;
    }

    const response = await nativeFetch(request);
    if (
      (response.status === 401 || response.status === 403) &&
      !isPrefetchRequest(request) &&
      !uploadRequest &&
      !authCheckRequest
    ) {
      await redirectToSignInIfSignedOut();
    }
    if (shouldInvalidateCanonicalApiCache(method, apiUrl.searchParams, response.status)) {
      apiMemoryCache.clearCanonical(apiUrl, cacheScope);
    }
    if (useMemoryCache) {
      void apiMemoryCache
        .write(apiUrl, request.headers, response, cacheScope, cacheVersion)
        .catch(() => undefined);
    } else if (method !== 'GET' && response.ok) {
      apiMemoryCache.clearForMutation(apiUrl.pathname);
    }
    return response;
  };
}

export function canUseApiMemoryCache({
  cache,
  headers,
  pathname,
  searchParams,
}: ApiMemoryCachePolicyInput) {
  if (cache === 'no-store' || cache === 'no-cache' || cache === 'reload') return false;
  if (searchParams?.get('fresh') === '1') return false;
  if (!ttlForApiPath(pathname)) return false;

  const authorization = headers.get('authorization')?.trim() ?? '';
  if (/^Bearer\s+\S+$/i.test(authorization)) return true;

  return anonymousCacheableApiPaths.includes(pathname);
}

export function shouldInvalidateCanonicalApiCache(
  method: string,
  searchParams: Pick<URLSearchParams, 'get'>,
  responseStatus: number,
) {
  return (
    method.toUpperCase() === 'GET' &&
    searchParams.get('fresh') === '1' &&
    ((responseStatus >= 200 && responseStatus < 300) || responseStatus === 404)
  );
}

async function redirectToSignInIfSignedOut() {
  if (authRedirectInProgress) return;

  if (authStatusVerifier) {
    const status = await authStatusVerifier().catch((): AuthStatus => 'unknown');
    if (status !== 'signed-out') return;
  }

  authRedirectInProgress = true;
  const redirectUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  window.location.assign(`/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`);
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

function isAuthCheckRequest(request: Request) {
  return request.headers.get('x-lumen-auth-check') === '1';
}

function isCanvasUploadRequest(url: URL, method: string) {
  return (
    method === 'POST' &&
    (url.pathname === '/api/canvas/uploads' || url.pathname === '/api/canvas/uploads/presign')
  );
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

function ttlForApiPath(pathname: string) {
  return apiCacheTtlByPath.find(([cachePath]) => pathname === cachePath)?.[1] ?? 0;
}

function matchesApiPathPrefix(pathname: string, prefix: string) {
  if (prefix.endsWith('/')) return pathname.startsWith(prefix);
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

export function createApiMemoryResponseCache(now: () => number = Date.now): ApiMemoryResponseCache {
  const entries = new Map<string, CachedApiResponse>();
  let activeBearerCredential: string | null = null;
  let invalidationVersion = 0;
  let privateGeneration = 0;

  const deletePrivateEntries = () => {
    for (const [key, entry] of entries) {
      if (entry.scopeKind === 'private') entries.delete(key);
    }
  };

  const pruneExpiredEntries = () => {
    const currentTime = now();
    for (const [key, entry] of entries) {
      if (entry.expiresAt <= currentTime) entries.delete(key);
    }
  };

  const isCurrentScope = (scope: ApiMemoryCacheScope) =>
    scope.kind === 'anonymous' || scope.generation === privateGeneration;

  return {
    captureScope(headers) {
      const credential = readBearerCredential(headers);
      if (!credential) return anonymousApiCacheScope;

      if (credential !== activeBearerCredential) {
        activeBearerCredential = credential;
        privateGeneration += 1;
        deletePrivateEntries();
      }
      return {
        kind: 'private',
        generation: privateGeneration,
        key: `private:${privateGeneration}`,
      };
    },

    captureVersion() {
      return invalidationVersion;
    },

    clearCanonical(url, scope) {
      if (!isCurrentScope(scope)) return;
      invalidationVersion += 1;
      for (const [key, entry] of entries) {
        if (entry.scopeKey === scope.key && entry.pathname === url.pathname) entries.delete(key);
      }
    },

    clearForMutation(pathname) {
      const projectTouched =
        matchesApiPathPrefix(pathname, '/api/projects') ||
        matchesApiPathPrefix(pathname, '/api/folders') ||
        (pathname.startsWith('/api/home/templates/') && pathname.endsWith('/clone'));
      const materialTouched = matchesApiPathPrefix(pathname, '/api/material-assets');
      if (!projectTouched && !materialTouched) return;
      invalidationVersion += 1;

      for (const [key, entry] of entries) {
        if (
          projectTouched &&
          (matchesApiPathPrefix(entry.pathname, '/api/projects') ||
            matchesApiPathPrefix(entry.pathname, '/api/folders'))
        ) {
          entries.delete(key);
        } else if (
          materialTouched &&
          matchesApiPathPrefix(entry.pathname, '/api/material-assets')
        ) {
          entries.delete(key);
        }
      }
    },

    clearPrivate() {
      activeBearerCredential = null;
      invalidationVersion += 1;
      privateGeneration += 1;
      deletePrivateEntries();
    },

    read(url, headers, scope) {
      if (!isCurrentScope(scope)) return null;
      pruneExpiredEntries();
      const cached = entries.get(apiCacheKey(url, headers, scope));
      if (!cached) return null;
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers: cached.headers,
      });
    },

    size() {
      pruneExpiredEntries();
      return entries.size;
    },

    async write(url, headers, response, scope, version) {
      if (!response.ok || !isCurrentScope(scope) || version !== invalidationVersion) return;
      const ttlMs = ttlForApiPath(url.pathname);
      if (!ttlMs) return;
      const cloned = response.clone();
      const contentType = cloned.headers.get('content-type') ?? '';
      if (!contentType.includes('application/json')) return;

      // This is tab-local application memoization. Upstream no-store headers protect
      // browser, proxy, and CDN caches without disabling this explicit allowlist.
      const body = await cloned.text();
      if (!isCurrentScope(scope) || version !== invalidationVersion) return;
      pruneExpiredEntries();
      entries.set(apiCacheKey(url, headers, scope), {
        body,
        expiresAt: now() + ttlMs,
        headers: Array.from(cloned.headers.entries()),
        pathname: url.pathname,
        scopeKey: scope.key,
        scopeKind: scope.kind,
        status: cloned.status,
        statusText: cloned.statusText,
      });
    },
  };
}

function readBearerCredential(headers: Pick<Headers, 'get'>) {
  const authorization = headers.get('authorization')?.trim() ?? '';
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] ?? null;
}

function apiCacheKey(url: URL, headers: Pick<Headers, 'get'>, scope: ApiMemoryCacheScope) {
  return `${scope.key}|${headers.get('x-lumen-locale') ?? 'en'}|${url.pathname}${url.search}`;
}
