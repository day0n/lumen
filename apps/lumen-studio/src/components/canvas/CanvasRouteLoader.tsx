'use client';

/**
 * 路由级 loading fallback：在 Next.js 切换到 /canvas 子路由时立即显示，
 * 但不播放动画。真正的画布加载动画由 CanvasWorkbench 统一负责，
 * 避免 route fallback 与 workbench hydration overlay 连续挂载造成视觉上跳两遍。
 */
export function CanvasRouteLoader() {
  return (
    <main
      className="relative h-screen w-screen overflow-hidden bg-[#050607]"
      aria-busy="true"
      aria-label="Loading canvas"
    />
  );
}
