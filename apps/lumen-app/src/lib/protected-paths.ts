import { stripLocalePrefix } from '../i18n/routing';

const LOGIN_REQUIRED_PREFIXES = [
  '/agent-chat',
  '/canvas',
  '/materials',
  '/app/dashboard',
  '/app/projects',
  '/app/canvas',
  '/app/materials',
] as const;

export function isLoginRequiredPath(href: string): boolean {
  const pathname = readPathname(href);
  if (!pathname) return false;

  const normalizedPath = stripLocalePrefix(pathname);
  return LOGIN_REQUIRED_PREFIXES.some(
    (prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`),
  );
}

function readPathname(href: string): string | null {
  try {
    if (/^https?:\/\//i.test(href)) {
      const url = new URL(href);
      if (typeof window === 'undefined' || url.origin !== window.location.origin) return null;
      return url.pathname;
    }

    if (!href.startsWith('/')) return null;
    return new URL(href, 'https://lumen.local').pathname;
  } catch {
    return null;
  }
}
