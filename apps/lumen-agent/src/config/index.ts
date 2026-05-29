/**
 * 配置 —— 用 zod 校验 env，只读。
 *
 * 加载顺序（后者覆盖前者）：
 *   1. process.env（CI / 部署平台注入）
 *   2. .env             （仓库内默认）
 *   3. .env.local       （开发本地，已被 .gitignore 排除）
 */

import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

for (const file of ['.env', '.env.local']) {
  const p = resolve(process.cwd(), file);
  if (existsSync(p)) dotenvConfig({ path: p, override: true });
}

const envSchema = z.object({
  // server
  PORT: z.coerce.number().int().positive().default(3001),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().optional(),

  // providers
  ANTHROPIC_API_KEY: z.string().optional().default(''),
  ARK_API_KEY: z.string().optional().default(''),
  ARK_BASE_URL: z.string().default('https://ark.cn-beijing.volces.com/api/v3'),
  ARK_TEXT_ENDPOINT: z.string().optional().default(''),

  DEFAULT_MODEL: z.string().default('claude-opus-4-7'),
  DEFAULT_MAX_TOKENS: z.coerce.number().int().positive().default(8192),

  // storage
  MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
  MONGODB_DB: z.string().default('lumen_agent'),
  REDIS_URL: z.string().optional().default(''),

  // tools
  BRAVE_API_KEY: z.string().optional().default(''),
  FOREPLAY_API_KEY: z.string().optional().default(''),
  FOREPLAY_BASE_URL: z.string().default('https://public.api.foreplay.co'),
  GOOGLE_OC_JSON: z.string().optional().default(''),
  VERTEX_GEMINI_PROJECT: z.string().optional().default(''),
  OPENAI_API_KEY: z.string().optional().default(''),

  HTTP_PROXY: z.string().optional().default(''),

  // auth & cors
  CLERK_ISSUER: z.string().default('https://clerk.dev'),
  CORS_ORIGINS: z.string().default('http://localhost:3000'),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (cached) return cached;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid env config: ${msg}`);
  }
  cached = parsed.data;
  return cached;
}
