'use client';

import { CanvasHydrationOverlay } from '@/components/canvas/CanvasHydrationOverlay';
import { useI18n } from '@/i18n/provider';

/**
 * 路由级 loading fallback：在 Next.js 切换到 /canvas 子路由时立即显示，
 * 直到对应 page 客户端 hydration 完成。和画布内的 hydration overlay 共用
 * 同一套动画，保证切换观感连续不闪烁。
 */
export function CanvasRouteLoader() {
  const { t } = useI18n();
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-[#050607]">
      <CanvasHydrationOverlay
        label={t('canvas.hydration.preparing')}
        hint={t('canvas.hydration.hint')}
      />
    </main>
  );
}
