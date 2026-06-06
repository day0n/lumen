import { toAppPath } from './path-map';

let routeWarmup: Promise<unknown> | null = null;
let dataWarmup: Promise<unknown> | null = null;
const intentWarmups = new Map<string, Promise<unknown>>();

export function warmCurrentAppRoute(pathname = window.location.pathname) {
  const routePath = readAppRoutePath(pathname);

  if (routePath === '/' || routePath.startsWith('/home')) {
    return import('@/app/home/page');
  }
  if (routePath.startsWith('/dashboard')) {
    return import('@/components/studio/DashboardPage');
  }
  if (routePath.startsWith('/hot-videos')) {
    return import('@/components/studio/HotVideosPage');
  }
  if (routePath.startsWith('/materials')) {
    return import('@/components/studio/MaterialsPage');
  }
  if (routePath.startsWith('/projects')) {
    return import('@/components/studio/WorkspacePage');
  }
  if (routePath.startsWith('/canvas')) {
    return Promise.allSettled([
      import('../features/canvas/CanvasRoute'),
      import('@/components/canvas/CanvasEntryLoader'),
      import('@/components/canvas/CanvasWorkbench'),
    ]);
  }

  return Promise.resolve();
}

export function warmAppRouteResources(
  href = window.location.pathname,
  { includeData = true }: { includeData?: boolean } = {},
) {
  const routePath = readAppRoutePath(href);
  const key = `${routePath}:${includeData ? 'data' : 'code'}`;
  const cached = intentWarmups.get(key);
  if (cached) return cached;

  const tasks: Promise<unknown>[] = [Promise.resolve(warmCurrentAppRoute(routePath))];
  if (includeData) tasks.push(warmAppRouteData(routePath));

  const warmup = Promise.allSettled(tasks);
  intentWarmups.set(key, warmup);
  return warmup;
}

export function scheduleAppWarmup({ includeData = true }: { includeData?: boolean } = {}) {
  void warmAppRoutes();

  if (!includeData) return;

  const runDataWarmup = () => {
    void warmAppData();
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(runDataWarmup, { timeout: 1200 });
  } else {
    globalThis.setTimeout(runDataWarmup, 350);
  }
}

function warmAppRoutes() {
  routeWarmup ??= Promise.allSettled([
    import('@/app/home/page'),
    import('@/components/studio/DashboardPage'),
    import('@/components/studio/HotVideosPage'),
    import('@/components/studio/MaterialsPage'),
    import('@/components/studio/WorkspacePage'),
    import('@/components/canvas/CanvasEntryLoader'),
    import('@/components/canvas/CanvasWorkbench'),
  ]);
  return routeWarmup;
}

function warmAppData() {
  dataWarmup ??= Promise.allSettled([
    prefetchApi('/api/projects'),
    prefetchApi('/api/folders'),
    prefetchApi('/api/material-assets?category=item&limit=80'),
    prefetchApi('/api/hot-videos?limit=24'),
  ]);
  return dataWarmup;
}

function warmAppRouteData(routePath: string) {
  return Promise.allSettled(dataUrlsForRoute(routePath).map(prefetchApi));
}

function dataUrlsForRoute(routePath: string) {
  if (routePath === '/' || routePath.startsWith('/home')) {
    return ['/api/home/featured', '/api/projects?limit=3'];
  }
  if (routePath.startsWith('/projects')) {
    return ['/api/folders', '/api/projects'];
  }
  if (routePath.startsWith('/materials')) {
    return ['/api/material-assets?category=item&limit=80'];
  }
  if (routePath.startsWith('/hot-videos')) {
    return ['/api/hot-videos?limit=24'];
  }
  if (routePath.startsWith('/dashboard')) {
    return ['/api/tiktok-dashboard?range=30d&region=global&channel=all&objective=sales&nonce=0'];
  }
  return [];
}

function prefetchApi(url: string) {
  return fetch(url, {
    credentials: 'include',
    headers: {
      'x-lumen-prefetch': '1',
    },
  }).catch(() => undefined);
}

function readAppRoutePath(href: string) {
  const url = new URL(toAppPath(href), 'https://lumen.local');
  return url.pathname.replace(/^\/app(?=\/|$)/, '') || '/home';
}
