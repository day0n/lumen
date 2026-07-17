'use client';

import { useCallback, useRef } from 'react';

export const APP_HOME_ROUTE = '/app/home';
export const APP_PROJECTS_ROUTE = '/app/projects';
export const APP_HOT_VIDEOS_ROUTE = '/app/hot-videos';
export const APP_MATERIALS_ROUTE = '/app/materials';
export const APP_CANVAS_NEW_ROUTE = '/app/canvas/new';

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
  }, []);

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
