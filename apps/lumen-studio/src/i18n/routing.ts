export const SUPPORTED_LOCALES = ['en', 'zh'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';
export const LUMEN_LOCALE_COOKIE = 'lumen_locale';
export const LUMEN_LOCALE_HEADER = 'x-lumen-locale';

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh';
}

export function getLocaleFromPathname(pathname: string): Locale {
  return pathname === '/zh' || pathname.startsWith('/zh/') ? 'zh' : DEFAULT_LOCALE;
}

export function stripLocalePrefix(pathname: string): string {
  if (pathname === '/zh' || pathname === '/en') return '/';
  if (pathname.startsWith('/zh/')) return pathname.slice(3) || '/';
  if (pathname.startsWith('/en/')) return pathname.slice(3) || '/';
  return pathname || '/';
}

export function hasEnglishPrefix(pathname: string): boolean {
  return pathname === '/en' || pathname.startsWith('/en/');
}

export function localePath(href: string, locale: Locale): string {
  if (!href || href.startsWith('http://') || href.startsWith('https://') || href.startsWith('#')) {
    return href;
  }

  const [pathAndQuery = '/', hash = ''] = href.split('#');
  const [rawPath = '/', query = ''] = pathAndQuery.split('?');
  const path = stripLocalePrefix(rawPath.startsWith('/') ? rawPath : `/${rawPath}`);
  const localizedPath = locale === 'zh' ? prefixZhPath(path) : path;
  return `${localizedPath}${query ? `?${query}` : ''}${hash ? `#${hash}` : ''}`;
}

export function switchLocalePath(pathname: string, targetLocale: Locale): string {
  return localePath(stripLocalePrefix(pathname || '/'), targetLocale);
}

export function withoutEnglishPrefix(pathname: string): string {
  if (pathname === '/en') return '/';
  if (pathname.startsWith('/en/')) return pathname.slice(3) || '/';
  return pathname || '/';
}

function prefixZhPath(pathname: string): string {
  if (pathname === '/') return '/zh';
  return `/zh${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
}
