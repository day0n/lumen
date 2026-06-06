'use client';

import { CanvasEntryLoader } from '@/components/canvas/CanvasEntryLoader';

/**
 * 路由级 loading fallback：在切换到 /canvas 子路由时立即显示全屏 entry loader，
 * Workbench hydration 阶段沿用同一视觉，避免 route fallback 与 overlay 连续切换造成双闪。
 */
export function CanvasRouteLoader() {
  return <CanvasEntryLoader />;
}
