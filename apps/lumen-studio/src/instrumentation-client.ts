/**
 * Sentry 浏览器端初始化（Next.js 客户端 instrumentation）。
 *
 * 范围：前端错误 + 性能 trace（pageload / navigation / fetch）。
 * 不开 Session Replay（PII + 带宽成本）。
 *
 * tracePropagationTargets 命中 agent origin 时，浏览器对 agent 的 fetch / SSE
 * 会自动带上 sentry-trace / baggage 头 —— Flow A（对话）由此自动串成一条 trace。
 */

import * as Sentry from '@sentry/nextjs';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? 'http://localhost:3001';

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN || undefined,
  environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  tracesSampleRate: process.env.SENTRY_TRACES_SAMPLE_RATE
    ? Number(process.env.SENTRY_TRACES_SAMPLE_RATE)
    : 1,
  integrations: [Sentry.browserTracingIntegration()],
  // 同源默认就传播；额外把 agent 跨域 origin 加进来。
  tracePropagationTargets: ['localhost', AGENT_URL, /^\//],
});

// 让 Next.js router 跳转也被记成 navigation transaction
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
