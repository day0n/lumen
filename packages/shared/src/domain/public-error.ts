import { z } from 'zod';

export const PublicErrorNameSchema = z.enum([
  'content_blocked',
  'real_person_detected',
  'model_execution_failed',
]);

export type PublicErrorName = z.infer<typeof PublicErrorNameSchema>;

export const PUBLIC_ERROR_CODES: Partial<Record<PublicErrorName, number>> = {
  content_blocked: 3005,
  real_person_detected: 4007,
};

export const PUBLIC_ERROR_I18N_KEYS = {
  content_blocked: 'canvas.errorCodes.contentBlocked',
  real_person_detected: 'canvas.errorCodes.realPersonDetected',
  model_execution_failed: 'canvas.errorCodes.runFailed',
} as const satisfies Record<PublicErrorName, string>;

export const PublicErrorFieldsSchema = z.object({
  errorCode: z.number().int().optional(),
  errorName: PublicErrorNameSchema.optional(),
  errorI18nKey: z.string().optional(),
  retryable: z.boolean().optional(),
  attempts: z.number().int().positive().optional(),
});

export type PublicErrorFields = z.infer<typeof PublicErrorFieldsSchema>;
