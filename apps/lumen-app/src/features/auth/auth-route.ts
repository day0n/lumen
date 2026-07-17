import type { AuthLocale } from './auth-copy';

export type AuthMode = 'sign-in' | 'sign-up';

export interface AuthRoute {
  locale: AuthLocale;
  mode: AuthMode;
  path: string;
  signInPath: string;
  signUpPath: string;
}

const AUTH_REDIRECT_PARAMETERS = [
  'redirect_url',
  'sign_in_force_redirect_url',
  'sign_in_fallback_redirect_url',
  'sign_up_force_redirect_url',
  'sign_up_fallback_redirect_url',
] as const;

export function parseAuthPathname(pathname: string): AuthRoute | null {
  const match = pathname.match(/^\/(zh\/)?(sign-in|sign-up)(?:\/.*)?$/);
  if (!match?.[2]) return null;
  const locale: AuthLocale = match[1] ? 'zh' : 'en';
  const signInPath = locale === 'zh' ? '/zh/sign-in' : '/sign-in';
  const signUpPath = locale === 'zh' ? '/zh/sign-up' : '/sign-up';
  const mode = match[2] as AuthMode;
  return {
    locale,
    mode,
    path: mode === 'sign-in' ? signInPath : signUpPath,
    signInPath,
    signUpPath,
  };
}

export function prepareAuthRedirect(
  currentUrl: URL,
  mode: AuthMode | undefined,
  fallback = '/app/home',
) {
  const priority =
    mode === 'sign-up'
      ? [
          'sign_up_force_redirect_url',
          'redirect_url',
          'sign_up_fallback_redirect_url',
          'sign_in_force_redirect_url',
          'sign_in_fallback_redirect_url',
        ]
      : [
          'sign_in_force_redirect_url',
          'redirect_url',
          'sign_in_fallback_redirect_url',
          'sign_up_force_redirect_url',
          'sign_up_fallback_redirect_url',
        ];
  const redirectUrl =
    priority
      .map((name) => currentUrl.searchParams.get(name) ?? '')
      .map((value) => normalizeSameOriginRedirect(value, currentUrl.origin))
      .find((value): value is string => Boolean(value)) ??
    normalizeSameOriginRedirect(fallback, currentUrl.origin) ??
    '/app/home';
  let changed = false;
  for (const name of AUTH_REDIRECT_PARAMETERS) {
    if (currentUrl.searchParams.has(name)) {
      currentUrl.searchParams.delete(name);
      changed = true;
    }
  }
  return {
    cleanedUrl: `${currentUrl.pathname}${currentUrl.search}${currentUrl.hash}`,
    changed,
    redirectUrl,
  };
}

export function normalizeSameOriginRedirect(value: string, origin: string) {
  if (!value || value.startsWith('//')) return null;
  let url: URL;
  try {
    url = new URL(value, origin);
  } catch {
    return null;
  }
  if (
    url.origin !== origin ||
    (url.protocol !== 'https:' && url.protocol !== 'http:') ||
    url.username ||
    url.password
  ) {
    return null;
  }
  if (/^\/(?:zh\/)?sign-(?:in|up)(?:\/|$)/.test(url.pathname)) return null;
  return `${url.pathname}${url.search}${url.hash}`;
}
