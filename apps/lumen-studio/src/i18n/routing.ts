export const SUPPORTED_LOCALES = ['en', 'zh'] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'en';
export const LUMEN_LOCALE_COOKIE = 'lumen_locale';
export const LUMEN_LOCALE_HEADER = 'x-lumen-locale';

export function isLocale(value: unknown): value is Locale {
  return value === 'en' || value === 'zh';
}

/**
 * 从浏览器语言标签（navigator.language / navigator.languages 元素 / Accept-Language 单项）
 * 推断 locale。只要主语言是中文（zh、zh-CN、zh-Hans...）就归到 'zh'，否则返回 null 交给上层兜底。
 */
export function localeFromLanguageTag(tag: string | null | undefined): Locale | null {
  if (!tag) return null;
  const primary = tag.trim().toLowerCase().split('-')[0];
  if (primary === 'zh') return 'zh';
  if (primary === 'en') return 'en';
  return null;
}

/**
 * 解析 Accept-Language 头（含 q 权重），取权重最高、且我们支持的语言。
 * 用于服务端在没有 cookie / 显式 locale 时按用户浏览器偏好兜底，
 * 避免中文用户首次访问被默认成英文（连带默认项目名也变英文）。
 */
export function localeFromAcceptLanguage(header: string | null | undefined): Locale | null {
  if (!header) return null;
  const candidates = header
    .split(',')
    .map((part) => {
      const [tag, ...params] = part.trim().split(';');
      const qParam = params.find((param) => param.trim().startsWith('q='));
      const q = qParam ? Number.parseFloat(qParam.trim().slice(2)) : 1;
      return { tag: tag?.trim() ?? '', q: Number.isFinite(q) ? q : 0 };
    })
    .filter((candidate) => candidate.tag.length > 0)
    .sort((a, b) => b.q - a.q);

  for (const candidate of candidates) {
    const locale = localeFromLanguageTag(candidate.tag);
    if (locale) return locale;
  }
  return null;
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
