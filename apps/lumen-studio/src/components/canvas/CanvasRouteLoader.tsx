'use client';

import { useI18n } from '@/i18n/provider';

/**
 * 路由级 loading fallback：在 Next.js 切换到 /canvas 子路由时立即显示，
 * 直到对应 page 客户端 hydration 完成。这里刻意不渲染中心品牌 mark，
 * 避免随后画布内部 hydration overlay 接管时看起来像 logo 出现了两次。
 */
export function CanvasRouteLoader() {
  const { t } = useI18n();
  return (
    <main
      className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-[#050607]"
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 38%, rgba(15,22,30,0.94) 0%, rgba(5,6,7,0.97) 62%)',
        }}
      />
      <div className="relative flex w-[220px] flex-col items-center">
        <div className="h-px w-full overflow-hidden rounded-full bg-white/10">
          <div className="h-full w-1/2 animate-[pulse_1.4s_ease-in-out_infinite] rounded-full bg-gradient-to-r from-transparent via-[#79e4ff] to-[#f5c76a]" />
        </div>
        <div className="mt-5 text-[11px] font-bold uppercase tracking-[0.32em] text-white/46">
          {t('canvas.hydration.preparing')}
        </div>
        <div className="mt-2 text-[12px] font-medium text-white/34">{t('canvas.hydration.hint')}</div>
      </div>
    </main>
  );
}
