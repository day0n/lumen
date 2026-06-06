let routeWarmup: Promise<unknown> | null = null;
let dataWarmup: Promise<unknown> | null = null;

export function warmCurrentAppRoute(pathname = window.location.pathname) {
  const routePath = pathname.replace(/^\/app(?=\/|$)/, '') || '/home';

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

  return Promise.resolve();
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
  ]);
  return routeWarmup;
}

function warmAppData() {
  dataWarmup ??= Promise.allSettled([
    fetch('/api/projects'),
    fetch('/api/folders'),
    fetch('/api/material-assets'),
    fetch('/api/hot-videos?limit=24'),
  ]);
  return dataWarmup;
}
