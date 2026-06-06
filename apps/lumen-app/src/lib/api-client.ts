type TokenGetter = () => Promise<string | null>;

let installed = false;
let tokenGetter: TokenGetter | null = null;

export function setApiTokenGetter(getter: TokenGetter | null) {
  tokenGetter = getter;
}

export async function apiFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const request = normalizeRequest(input, init);
  const token = await tokenGetter?.();
  if (token) request.headers.set('Authorization', `Bearer ${token}`);
  request.headers.set('x-lumen-locale', readLocale());
  return fetch(request);
}

export function installApiFetchInterceptor() {
  if (installed || typeof window === 'undefined') return;
  installed = true;

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (!isSameOriginApiRequest(input)) return nativeFetch(input, init);

    const request = normalizeRequest(input, init);
    const token = await tokenGetter?.();
    if (token && !request.headers.has('Authorization')) {
      request.headers.set('Authorization', `Bearer ${token}`);
    }
    if (!request.headers.has('x-lumen-locale')) {
      request.headers.set('x-lumen-locale', readLocale());
    }

    const response = await nativeFetch(request);
    if (response.status === 401 || response.status === 403) {
      const redirectUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.assign(`/sign-in?redirect_url=${encodeURIComponent(redirectUrl)}`);
    }
    return response;
  };
}

function normalizeRequest(input: RequestInfo | URL, init: RequestInit) {
  const request = new Request(input, init);
  return new Request(request, {
    headers: new Headers(request.headers),
  });
}

function isSameOriginApiRequest(input: RequestInfo | URL) {
  const raw = input instanceof Request ? input.url : input.toString();
  const url = new URL(raw, window.location.origin);
  return url.origin === window.location.origin && url.pathname.startsWith('/api/');
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
