/**
 * Sentry bootstrap —— 必须在任何其它模块之前求值。
 *
 * 为什么单独读 SENTRY_*（不走 config.ts）：Sentry.init 要早于 undici / pino /
 * @google/genai 被 import 才能自动埋点，而 config.ts 依赖 MONGODB_URI 等必填项，
 * 缺它们不应该顺带让可观测性挂掉。这里用最小内联 zod 单独解析。
 *
 * DSN 留空时 Sentry.init 优雅 no-op。
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
