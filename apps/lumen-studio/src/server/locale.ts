import type { Locale } from '@/i18n/routing';
import {
  DEFAULT_LOCALE,
  LUMEN_LOCALE_COOKIE,
  LUMEN_LOCALE_HEADER,
  getLocaleFromPathname,
  isLocale,
} from '@/i18n/routing';

export function resolveRequestLocale(request: Request): Locale {
  const headerLocale = request.headers.get(LUMEN_LOCALE_HEADER);
  if (isLocale(headerLocale)) return headerLocale;

  const url = new URL(request.url);
  const queryLocale = url.searchParams.get('locale') ?? url.searchParams.get('lang');
  if (isLocale(queryLocale)) return queryLocale;

  const cookieLocale = readCookie(request.headers.get('cookie'), LUMEN_LOCALE_COOKIE);
  if (isLocale(cookieLocale)) return cookieLocale;

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      return getLocaleFromPathname(new URL(referer).pathname);
    } catch {
      /* ignore malformed referer */
    }
  }

  return DEFAULT_LOCALE;
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [rawKey, ...rawValue] = part.trim().split('=');
    if (rawKey === name) return decodeURIComponent(rawValue.join('='));
  }
  return null;
}
