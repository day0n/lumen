/**
 * Sentry 浏览器端初始化（Next.js 客户端 instrumentation）。
 *
 * 范围：前端错误 + 性能 trace（pageload / navigation / fetch）。
 * 不开 Session Replay（PII + 带宽成本）。
 *
 * ClerkJS 会请求 clerk.lumenstudio.tech；Clerk CORS 不允许 sentry-trace /
 * baggage 预检头，所以这里关闭浏览器自动 fetch/XHR tracing。Agent / workflow
 * 链路在业务代码里显式传递 trace，不依赖这个自动注入。
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
    ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
    : 1,
  integrations: [
    Sentry.browserTracingIntegration({
      traceFetch: false,
      traceXHR: false,
    }),
  ],
});

// 让 Next.js router 跳转也被记成 navigation transaction
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
