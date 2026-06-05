'use client';

let preloadPromise: Promise<unknown> | null = null;

export function preloadCanvasHydrationOverlay() {
  if (typeof window === 'undefined') return Promise.resolve();
  if (preloadPromise) return preloadPromise;

  preloadPromise = import('@/components/canvas/CanvasHydrationOverlay')
    .then((module) => module.warmCanvasHydrationOverlay())
    .catch((error) => {
      preloadPromise = null;
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[canvas] hydration overlay preload failed', error);
      }
    });

  return preloadPromise;
}
