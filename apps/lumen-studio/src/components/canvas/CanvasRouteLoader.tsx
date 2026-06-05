'use client';

/**
 * 路由级 loading fallback：在 Next.js 切换到 /canvas 子路由时立即显示，
 * 这里只放轻量 CSS 占位，真正的 WebGL 加载动画由 CanvasWorkbench 统一负责，
 * 避免 route fallback 与 workbench hydration overlay 连续挂载造成视觉上跳两遍。
 */
export function CanvasRouteLoader() {
  return (
    <main
      className="relative h-screen w-screen overflow-hidden bg-[#050607]"
      aria-busy="true"
      aria-label="Loading canvas"
    >
      <div
        className="absolute inset-0 opacity-80"
        style={{
          background:
            'radial-gradient(circle at 50% 48%, rgba(168,85,247,0.34), transparent 12%), repeating-conic-gradient(from -14deg at 50% 48%, rgba(168,85,247,0.46) 0deg 4deg, rgba(124,58,237,0.22) 4deg 8deg, transparent 8deg 18deg), radial-gradient(circle at 50% 48%, rgba(99,102,241,0.2), transparent 46%)',
          filter: 'blur(2px)',
          maskImage: 'radial-gradient(circle at 50% 50%, black 0%, black 54%, transparent 82%)',
        }}
      />
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(circle at 50% 48%, transparent 0%, rgba(5,6,7,0.22) 42%, rgba(5,6,7,0.82) 88%), linear-gradient(180deg, rgba(5,6,7,0.18), rgba(5,6,7,0.62))',
        }}
      />
    </main>
  );
}
