import * as Sentry from '@sentry/node';
import pino from 'pino';

const isDev = process.env.NODE_ENV !== 'production';

export const logger = pino({
  level: process.env.LOG_LEVEL ?? (isDev ? 'debug' : 'info'),
  formatters: {
    // 每条日志自动带上当前活跃 span 的 trace_id，stdout(pm2) 和 Sentry 用同一个 id。
    log: (obj) => {
      const trace_id = getTraceId();
      return trace_id ? { trace_id, ...obj } : obj;
    },
  },
  // dev 走 pino-pretty 方便看；prod 输出 JSON 到 stdout 给 pm2 收集。
  // 两种格式 Sentry pinoIntegration 都能抓到。
  transport: isDev
    ? {
        target: 'pino-pretty',
        options: { colorize: true },
      }
    : undefined,
});

/** 当前活跃 Sentry span 的 trace_id（无 span 时返回 undefined）。 */
export function getTraceId(): string | undefined {
  const span = Sentry.getActiveSpan();
  if (!span) return undefined;
  return Sentry.spanToJSON(span).trace_id;
}
