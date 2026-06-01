'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';

const HOME_ROUTE = '/home';
const HOME_FEATURED_ENDPOINT = '/api/home/featured';

const HOME_POSTERS = [
  '/home-posters/selected/agent-pop.png',
  '/home-posters/selected/material-mythic.png',
  '/home-posters/selected/hot-remix-collage.png',
  '/home-posters/selected/agent-chat-minimal.png',
  '/home-posters/selected/material-archive.png',
  '/home-posters/selected/agent-glass.png',
] as const;

type WindowWithIdleCallback = Window &
  typeof globalThis & {
    requestIdleCallback?: (callback: IdleRequestCallback, options?: IdleRequestOptions) => number;
    cancelIdleCallback?: (handle: number) => void;
  };

export function useHomeRoutePreload() {
  const router = useRouter();
  const assetsWarmedRef = useRef(false);

  const warmHomeRoute = useCallback(() => {
    router.prefetch(HOME_ROUTE);

    if (assetsWarmedRef.current || typeof window === 'undefined') return;
    assetsWarmedRef.current = true;

    void fetch(HOME_FEATURED_ENDPOINT, {
      credentials: 'include',
    }).catch(() => undefined);

    for (const url of HOME_POSTERS) {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
    }
  }, [router]);

  useEffect(() => {
    const idleWindow = window as WindowWithIdleCallback;

    if (idleWindow.requestIdleCallback) {
      const handle = idleWindow.requestIdleCallback(() => warmHomeRoute(), { timeout: 1800 });
      return () => idleWindow.cancelIdleCallback?.(handle);
    }

    const handle = window.setTimeout(warmHomeRoute, 450);
    return () => window.clearTimeout(handle);
  }, [warmHomeRoute]);

  return warmHomeRoute;
}
