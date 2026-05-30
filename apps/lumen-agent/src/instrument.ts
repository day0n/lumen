/**
 * Sentry bootstrap —— 必须在任何其它模块之前求值。
 *
 * 为什么单独一个文件、而且只在这里读 SENTRY_* 环境变量（不走 config/index.ts）：
 *   Sentry.init 必须早于 @anthropic-ai/sdk / undici / pino 等被 import，
 *   这样自动埋点才能 patch 到 HTTP 层。而 config/index.ts 的 zod schema 依赖
 *   MONGODB_URI 等必填项，若把 SENTRY_* 塞进去，缺 Mongo URL 就会顺带让
 *   可观测性挂掉。所以这里用最小内联 zod 单独解析，互不影响。
 *
 * DSN 留空时 Sentry.init 优雅 no-op：所有 startSpan/getTraceData/continueTrace
 * 仍可调用，只是不上报。
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import * as Sentry from '@sentry/node';
import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

for (const file of ['.env', '.env.local']) {
  const p = resolve(process.cwd(), file);
  if (existsSync(p)) dotenvConfig({ path: p, override: true });
}

const SentryEnvSchema = z.object({
  SENTRY_DSN: z.string().optional().default(''),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(1),
  NODE_ENV: z.string().optional().default('development'),
});

const env = SentryEnvSchema.parse(process.env);

Sentry.init({
  dsn: env.SENTRY_DSN || undefined,
  environment: env.SENTRY_ENVIRONMENT || env.NODE_ENV,
  enableLogs: true,
  tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE,
  integrations: [Sentry.pinoIntegration()],
});
