/**
 * Pino logger — 用 AsyncLocalStorage 在 SSE 请求链路上传播 session_id 等字段。
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import * as Sentry from '@sentry/node';
import pino from 'pino';

interface LogContext {
  session_id?: string;
  run_id?: string;
  user_id?: string;
  trace_id?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

const isDev = process.env.NODE_ENV !== 'production';

const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  formatters: {
    bindings: () => ({}),
    log: (obj) => {
      const ctx = storage.getStore() ?? {};
      // 优先用 context 里显式塞的 trace_id；否则回退到当前活跃 span，
      // 这样 provider / tool 等在 span 内但不在 log context 里的日志也能关联。
      const trace_id = ctx.trace_id ?? getTraceId();
      return {
        session_id: ctx.session_id ?? '-',
        run_id: ctx.run_id,
        user_id: ctx.user_id,
        trace_id,
        ...obj,
      };
    },
  },
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'yyyy-mm-dd HH:MM:ss.l',
          ignore: 'pid,hostname',
          singleLine: false,
        },
      }
    : undefined,
});

export const logger = baseLogger;

export function withLogContext<T>(ctx: LogContext, fn: () => T): T {
  const merged = { ...storage.getStore(), ...ctx };
  return storage.run(merged, fn);
}

export function getLogContext(): LogContext {
  return storage.getStore() ?? {};
}

/** 当前活跃 Sentry span 的 trace_id（无 span 时返回 undefined）。 */
export function getTraceId(): string | undefined {
  const span = Sentry.getActiveSpan();
  if (!span) return undefined;
  return Sentry.spanToJSON(span).trace_id;
}
