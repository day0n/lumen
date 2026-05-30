import { z } from 'zod';

const StudioServerConfigSchema = z
  .object({
    MONGODB_URI: z.string().min(1, 'MONGODB_URI is required'),
    MONGODB_DB: z.string().min(1).default('lumen_app'),
    WORKFLOW_MONGODB_DB: z.string().min(1).default('lumen_engine'),
    REDIS_URL: z.string().optional().default(''),
    APIFY_API_TOKEN: z.string().optional().default(''),
    R2_ACCOUNT_ID: z.string().optional().default(''),
    R2_BUCKET: z.string().optional().default(''),
    R2_ACCESS_KEY_ID: z.string().optional().default(''),
    R2_SECRET_ACCESS_KEY: z.string().optional().default(''),
    R2_PUBLIC_BASE_URL: z.string().optional().default(''),
    NEXT_PUBLIC_APP_URL: z.string().optional().default(''),
  })
  .passthrough();

export type StudioServerConfig = Pick<
  z.infer<typeof StudioServerConfigSchema>,
  | 'MONGODB_URI'
  | 'MONGODB_DB'
  | 'WORKFLOW_MONGODB_DB'
  | 'REDIS_URL'
  | 'APIFY_API_TOKEN'
  | 'R2_ACCOUNT_ID'
  | 'R2_BUCKET'
  | 'R2_ACCESS_KEY_ID'
  | 'R2_SECRET_ACCESS_KEY'
  | 'R2_PUBLIC_BASE_URL'
  | 'NEXT_PUBLIC_APP_URL'
>;

let cachedConfig: StudioServerConfig | null = null;

export function getStudioServerConfig(): StudioServerConfig {
  if (cachedConfig) return cachedConfig;

  const parsed = StudioServerConfigSchema.safeParse(process.env);
  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join('.')}: ${issue.message}`)
      .join('; ');
    throw new Error(`Invalid studio server config: ${message}`);
  }

  cachedConfig = parsed.data;
  return cachedConfig;
}
