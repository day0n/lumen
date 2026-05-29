import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { config as dotenvConfig } from 'dotenv';
import { z } from 'zod';

for (const file of ['.env', '.env.local']) {
  const p = resolve(process.cwd(), file);
  if (existsSync(p)) dotenvConfig({ path: p, override: true });
}

const EnvSchema = z.object({
  PORT: z.coerce.number().default(3002),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  MONGODB_URI: z.string().min(1),
  MONGODB_DB: z.string().default('lumen_engine'),
  R2_ACCOUNT_ID: z.string().optional().default(''),
  R2_BUCKET: z.string().optional().default(''),
  R2_ACCESS_KEY_ID: z.string().optional().default(''),
  R2_SECRET_ACCESS_KEY: z.string().optional().default(''),
  R2_PUBLIC_BASE_URL: z.string().optional().default(''),
  GOOGLE_OC_JSON: z.string().min(1),
  GOOGLE_CLOUD_PROJECT: z.string().min(1),
  GOOGLE_CLOUD_LOCATION: z.string().default('global'),
  FISH_AUDIO_API_KEY: z.string().min(1),
});

export const config = EnvSchema.parse(process.env);
