/**
 * Sentry 服务端初始化（单例模块）。
 *
 * 被两处 import，靠 ES 模块单例保证只 init 一次：
 *   1. src/instrumentation.ts register()  —— 覆盖 Next RSC / route handler
 *   2. 根目录 server.ts 第一行          —— 覆盖自定义 server + WS gateway
 *      （WS gateway 不在 Next 请求链里，必须在 tsx 进程里直接 init）
 *
 * SENTRY_* 直接读 env：init 必须早于其它模块，不能依赖 server/config.ts 的
 * zod schema（那个 schema 缺 MONGODB_URI 会抛错，不该连累可观测性）。
 * DSN 留空时优雅 no-op。
 */

import * as Sentry from '@sentry/nextjs';

if (!Sentry.getClient()) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN || process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
    enableLogs: true,
    tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
      ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
      : 1,
    integrations: [
      // pino 日志（WS gateway 用）进 Sentry Logs
      Sentry.pinoIntegration(),
      // 现有 RSC / server action 里的 console.* 不重写也进 Sentry Logs
      Sentry.consoleLoggingIntegration({ levels: ['log', 'warn', 'error'] }),
    ],
  });
}
