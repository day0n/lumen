/**
 * Next.js instrumentation 入口 —— register() 在 Node runtime 启动时执行一次。
 *
 * 注意：这个仓库用自定义 server（根 server.ts），它也会直接 import
 * sentry.server.config，靠单例守卫不会重复 init。这里覆盖标准 Next 启动路径
 * （如未来切回 `next start`），两条路都保证 Sentry 就绪。
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./sentry.server.config');
  }
}

export { captureRequestError as onRequestError } from '@sentry/nextjs';
