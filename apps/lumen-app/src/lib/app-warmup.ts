let routeWarmup: Promise<unknown> | null = null;
let dataWarmup: Promise<unknown> | null = null;

export function scheduleAppWarmup() {
  void warmAppRoutes();

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
    fetch('/api/hot-videos'),
  ]);
  return dataWarmup;
}
