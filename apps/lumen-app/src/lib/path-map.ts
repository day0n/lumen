const APP_PREFIX = '/app';

/**
 * 把任意 href 归一化到 SPA 的真实路径。
 *
 * SPA（/app/*）上语言完全靠 cookie + localStorage 持久化，URL 不带 /zh 前缀，
 * 这样可以避免和 TanStack Router 的 basepath="/app" 冲突。
 */
export function toAppPath(href: string): string {
  if (!href || href.startsWith('#') || /^https?:\/\//i.test(href)) return href;

  const url = new URL(href, 'https://lumen.local');
  const pathname = collapseStudioAppPath(stripLocalePrefix(url.pathname));
  let nextPath = pathname;

  if (pathname === '/home') nextPath = '/app/home';
  else if (pathname === '/dashboard') nextPath = '/app/home';
  else if (pathname === '/materials') nextPath = '/app/materials';
  else if (pathname === '/hot-videos') nextPath = '/app/hot-videos';
  else if (pathname === '/agent-chat') {
    nextPath = '/app/canvas/new';
    url.searchParams.set('agent', 'chat');
  } else if (pathname === '/canvas/projects') nextPath = '/app/projects';
  else if (pathname === '/canvas/new') nextPath = '/app/canvas/new';
  else if (pathname.startsWith('/canvas/')) nextPath = `/app${pathname}`;
  else if (pathname.startsWith('/app/')) nextPath = pathname;

  return `${nextPath}${url.search}${url.hash}`;
}

export function toRouterPath(href: string): { to: string; search: Record<string, string> } | null {
  const appHref = toAppPath(href);
  if (!appHref.startsWith(APP_PREFIX)) return null;

  const url = new URL(appHref, 'https://lumen.local');
  const to = url.pathname.slice(APP_PREFIX.length) || '/';
  return {
    to,
    search: Object.fromEntries(url.searchParams.entries()),
  };
}

export function currentAppRedirectUrl(): string {
  if (typeof window === 'undefined') return '/app/home';
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function stripLocalePrefix(pathname: string): string {
  if (pathname === '/zh' || pathname === '/en') return '/';
  if (pathname.startsWith('/zh/')) return pathname.slice(3) || '/';
  if (pathname.startsWith('/en/')) return pathname.slice(3) || '/';
  return pathname || '/';
}

/**
 * 折叠脏 URL：之前的 bug 会让 `/app/zh/app/...` 一层层叠加。
 * 这里把 `/app/<zh|en>/app/` 这类递归前缀压平回 `/app/...`，确保
 * 即便用户被重定向到坏 URL，下一次进入也能算出正确的真实路径。
 */
export function collapseStudioAppPath(pathname: string): string {
  let next = pathname;
  while (true) {
    const cleaned = next.replace(/^\/app\/(?:zh|en)\/app\//, '/app/');
    if (cleaned === next) return cleaned;
    next = cleaned;
  }
}
