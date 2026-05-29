/**
 * Pino logger — 用 AsyncLocalStorage 在 SSE 请求链路上传播 session_id 等字段。
 */

import { AsyncLocalStorage } from 'node:async_hooks';
import pino from 'pino';

interface LogContext {
  session_id?: string;
  run_id?: string;
  user_id?: string;
}

const storage = new AsyncLocalStorage<LogContext>();

const isDev = process.env.NODE_ENV !== 'production';

const baseLogger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  formatters: {
    bindings: () => ({}),
    log: (obj) => {
      const ctx = storage.getStore();
      if (ctx) {
        return {
          session_id: ctx.session_id ?? '-',
          run_id: ctx.run_id,
          user_id: ctx.user_id,
          ...obj,
        };
      }
      return { session_id: '-', ...obj };
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
