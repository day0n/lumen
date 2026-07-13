import type { Locale } from '@lumen/backend';

const DEFAULT_LOCALE: Locale = 'en';
const LOCALE_COOKIE = 'lumen_locale';
const LOCALE_HEADER = 'x-lumen-locale';

export function resolveRequestLocale(request: Request): Locale {
  const headerLocale = request.headers.get(LOCALE_HEADER);
  if (isLocale(headerLocale)) return headerLocale;

  const url = new URL(request.url);
  const queryLocale = url.searchParams.get('locale') ?? url.searchParams.get('lang');
  if (isLocale(queryLocale)) return queryLocale;

  const cookieLocale = readCookie(request.headers.get('cookie'), LOCALE_COOKIE);
  if (isLocale(cookieLocale)) return cookieLocale;

  const referer = request.headers.get('referer');
  if (referer) {
    try {
      const pathname = new URL(referer).pathname;
      if (!pathname.startsWith('/app'))
        return pathname === '/zh' || pathname.startsWith('/zh/') ? 'zh' : 'en';
    } catch {
      // Ignore malformed referers and continue to Accept-Language.
    }
  }

  return localeFromAcceptLanguage(request.headers.get('accept-language')) ?? DEFAULT_LOCALE;
}

function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh';
}

function localeFromAcceptLanguage(header: string | null): Locale | null {
  if (!header) return null;
  const candidates = header
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const qParam = params.find((param) => param.trim().startsWith('q='));
      const parsedQ = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), q: Number.isFinite(parsedQ) ? parsedQ : 0 };
    })
    .sort((a, b) => b.q - a.q);

  for (const candidate of candidates) {
    const primary = candidate.tag.split('-')[0];
    if (primary === 'zh' || primary === 'en') return primary;
  }
  return null;
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(';')) {
    const [key, ...rawValue] = part.trim().split('=');
    if (key !== name) continue;
    try {
      return decodeURIComponent(rawValue.join('='));
    } catch {
      return rawValue.join('=');
    }
  }
  return null;
}
