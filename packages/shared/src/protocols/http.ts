import { z } from 'zod';

export const ApiErrorSchema = z.object({
  ok: z.literal(false),
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.unknown()).optional(),
  }),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;

export const HealthCheckSchema = z.object({
  ok: z.literal(true),
  service: z.string(),
  version: z.string().optional(),
  ts: z.number(),
});
export type HealthCheck = z.infer<typeof HealthCheckSchema>;
