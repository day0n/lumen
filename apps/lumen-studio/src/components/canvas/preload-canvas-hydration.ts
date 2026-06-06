'use client';

let preloadPromise: Promise<unknown> | null = null;

export function preloadCanvasHydrationOverlay() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (preloadPromise) return preloadPromise;

  preloadPromise = Promise.allSettled([
    import('@/components/canvas/CanvasEntryLoader'),
    import('@/components/canvas/CanvasWorkbench'),
  ]).catch((error) => {
    preloadPromise = null;
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[canvas] entry loader preload failed', error);
    }
  });

  return preloadPromise;
}
