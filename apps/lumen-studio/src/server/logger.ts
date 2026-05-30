/**
 * Studio 服务端 pino logger（自定义 server + WS gateway 用）。
 *
 * studio 原本只有零散 console.*；这里给非 Next 请求链路（server.ts / ws gateway）
 * 一个结构化 logger，每条日志自动带当前活跃 Sentry span 的 trace_id，
 * 让 Flow B（工作流）的 studio 端日志能按 trace_id 关联。
 *
 * RSC / server action 里的 console.* 不走这里，由 consoleLoggingIntegration 兜。
 */

import * as Sentry from '@sentry/nextjs';
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  formatters: {
    log: (obj) => {
      const span = Sentry.getActiveSpan();
      const trace_id = span ? Sentry.spanToJSON(span).trace_id : undefined;
      return trace_id ? { trace_id, ...obj } : obj;
    },
  },
  transport: isDev ? { target: 'pino-pretty', options: { colorize: true } } : undefined,
});
