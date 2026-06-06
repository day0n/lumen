let routeWarmup: Promise<unknown> | null = null;
let dataWarmup: Promise<unknown> | null = null;

export function scheduleAppWarmup() {
  const run = () => {
    void warmAppRoutes();
    void warmAppData();
  };

  if ('requestIdleCallback' in window) {
    window.requestIdleCallback(run, { timeout: 1200 });
  } else {
    globalThis.setTimeout(run, 350);
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
    fetch('/api/hot-videos'),
  ]);
  return dataWarmup;
}
