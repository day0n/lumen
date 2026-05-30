const LOGIN_REQUIRED_PREFIXES = ['/canvas', '/materials'] as const;

export function isLoginRequiredPath(href: string): boolean {
  const pathname = readPathname(href);
  if (!pathname) return false;

  return LOGIN_REQUIRED_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}

function readPathname(href: string): string | null {
  try {
    if (/^https?:\/\//i.test(href)) {
      const url = new URL(href);
      if (typeof window !== 'undefined' && url.origin !== window.location.origin) {
        return null;
      }
      return url.pathname;
    }

    if (!href.startsWith('/')) return null;
    return new URL(href, 'https://lumen.local').pathname;
  } catch {
    return null;
  }
}
