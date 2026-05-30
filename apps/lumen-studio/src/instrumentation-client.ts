/**
 * Sentry 浏览器端初始化（Next.js 客户端 instrumentation）。
 *
 * 范围：前端错误 + 性能 trace（pageload / navigation / fetch）。
 * 不开 Session Replay（PII + 带宽成本）。
 *
 * ClerkJS 会请求 clerk.lumenstudio.tech；Clerk CORS 不允许 sentry-trace /
 * baggage 预检头，所以 trace 只传播到 Lumen 自己的 API / Agent 入口。
 * Workflow WebSocket 仍在业务代码里显式传递 trace。
 */

import * as Sentry from '@sentry/nextjs';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
    ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
    : 1,
  tracePropagationTargets: [/^https?:\/\/[^/]+\/api\//, /^https?:\/\/[^/]+\/v1\/agent\//],
  integrations: [
    Sentry.browserTracingIntegration({
      traceFetch: true,
      traceXHR: true,
    }),
  ],
});

// 让 Next.js router 跳转也被记成 navigation transaction
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
