'use client';

import { useMediaQuery } from '@/hooks/use-media-query';

/** Viewports below Tailwind `lg` (1024px) — matches Topbar mobile bottom nav. */
export const MOBILE_MEDIA_QUERY = '(max-width: 1023px)';

/** Tablet / phone canvas layout — below `md` (768px). */
export const MOBILE_CANVAS_MEDIA_QUERY = '(max-width: 767px)';

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_MEDIA_QUERY);
}

export function useIsMobileCanvas(): boolean {
  return useMediaQuery(MOBILE_CANVAS_MEDIA_QUERY);
}
