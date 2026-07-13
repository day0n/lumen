export function isCanvasShellRoute(pathname: string): boolean {
  const routePath = pathname.startsWith('/app/') ? pathname.slice('/app'.length) : pathname;
  return routePath === '/canvas/new' || routePath.startsWith('/canvas/');
}
