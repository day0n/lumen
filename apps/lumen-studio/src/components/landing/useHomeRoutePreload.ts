'use client';

import { useCallback, useEffect, useRef } from 'react';

export const APP_HOME_ROUTE = '/app/home';
export const APP_PROJECTS_ROUTE = '/app/projects';
export const APP_HOT_VIDEOS_ROUTE = '/app/hot-videos';

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
  const assetsWarmedRef = useRef(false);

  const warmHomeRoute = useCallback(() => {
    if (assetsWarmedRef.current || typeof window === 'undefined') return;
    assetsWarmedRef.current = true;

    prefetchResource(APP_HOME_ROUTE, 'document');
    void fetch(APP_HOME_ROUTE, {
      credentials: 'include',
    })
      .then(async (response) => {
        if (!response.ok) return;
        const html = await response.text();
        for (const assetUrl of readAppAssetUrls(html)) {
          prefetchResource(assetUrl, assetUrl.endsWith('.css') ? 'style' : 'script');
        }
      })
      .catch(() => undefined);

    void fetch(HOME_FEATURED_ENDPOINT, {
      credentials: 'include',
    }).catch(() => undefined);

    for (const url of HOME_POSTERS) {
      const image = new Image();
      image.decoding = 'async';
      image.src = url;
    }
  }, []);

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

function prefetchResource(href: string, as: 'document' | 'script' | 'style') {
  if (document.querySelector(`link[data-lumen-prefetch="${href}"]`)) return;
  const link = document.createElement('link');
  link.rel = 'prefetch';
  link.href = href;
  link.as = as;
  link.dataset.lumenPrefetch = href;
  document.head.appendChild(link);
}

function readAppAssetUrls(html: string) {
  return Array.from(html.matchAll(/(?:src|href)="([^"]*\/app\/assets\/[^"]+)"/g))
    .map((match) => match[1])
    .filter((url): url is string => Boolean(url));
}
