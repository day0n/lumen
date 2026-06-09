const APP_PREFIX = '/app';

export function toAppPath(href: string): string {
  if (!href || href.startsWith('#') || /^https?:\/\//i.test(href)) return href;

  const url = new URL(href, 'https://lumen.local');
  const localePrefix = readLocalePrefix(url.pathname);
  const pathname = stripLocalePrefix(url.pathname);
  let nextPath = pathname;

  if (pathname === '/home') nextPath = '/app/home';
  else if (pathname === '/dashboard') nextPath = '/app/dashboard';
  else if (pathname === '/materials') nextPath = '/app/materials';
  else if (pathname === '/hot-videos') nextPath = '/app/hot-videos';
  else if (pathname === '/agent-chat') {
    nextPath = '/app/canvas/new';
    url.searchParams.set('agent', 'chat');
  } else if (pathname === '/canvas/projects') nextPath = '/app/projects';
  else if (pathname === '/canvas/new') nextPath = '/app/canvas/new';
  else if (pathname.startsWith('/canvas/')) nextPath = `/app${pathname}`;
  else if (pathname.startsWith('/app/')) nextPath = pathname;

  return `${localePrefix}${nextPath}${url.search}${url.hash}`;
}

export function toRouterPath(href: string): { to: string; search: Record<string, string> } | null {
  const appHref = toAppPath(href);
  const appPathname = stripLocalePrefix(appHref);
  if (!appPathname.startsWith(APP_PREFIX)) return null;

  const url = new URL(appPathname, 'https://lumen.local');
  const to = url.pathname.slice(APP_PREFIX.length) || '/';
  return {
    to,
    search: Object.fromEntries(url.searchParams.entries()),
  };
}

export function currentAppRedirectUrl(): string {
  if (typeof window === 'undefined') return '/app/dashboard';
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function stripLocalePrefix(pathname: string): string {
  if (pathname === '/zh' || pathname === '/en') return '/';
  if (pathname.startsWith('/zh/')) return pathname.slice(3) || '/';
  if (pathname.startsWith('/en/')) return pathname.slice(3) || '/';
  return pathname || '/';
}

export function readLocalePrefix(pathname: string): '/zh' | '' {
  if (pathname === '/zh' || pathname.startsWith('/zh/')) return '/zh';
  return '';
}

export function getLocaleFromPathname(pathname: string): 'en' | 'zh' {
  return readLocalePrefix(pathname) === '/zh' ? 'zh' : 'en';
}
