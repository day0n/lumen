'use client';

import { useMediaQuery } from '@app/hooks/use-media-query';

export const MOBILE_MEDIA_QUERY = '(max-width: 1023px)';
export const MOBILE_CANVAS_MEDIA_QUERY = '(max-width: 767px)';

export function useIsMobile(): boolean {
  return useMediaQuery(MOBILE_MEDIA_QUERY);
}

export function useIsMobileCanvas(): boolean {
  return useMediaQuery(MOBILE_CANVAS_MEDIA_QUERY);
}
