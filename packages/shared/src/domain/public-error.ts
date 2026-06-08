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

function emptyToUndefined(value: unknown): unknown {
  return value === null ? undefined : value;
}

function emptyAttemptsToUndefined(value: unknown): unknown {
  return value === null || value === 0 ? undefined : value;
}

export const PublicErrorFieldsSchema = z.object({
  errorCode: z.preprocess(emptyToUndefined, z.number().int().optional()),
  errorName: z.preprocess(emptyToUndefined, PublicErrorNameSchema.optional()),
  errorI18nKey: z.preprocess(emptyToUndefined, z.string().optional()),
  retryable: z.preprocess(emptyToUndefined, z.boolean().optional()),
  attempts: z.preprocess(emptyAttemptsToUndefined, z.number().int().positive().optional()),
});

export type PublicErrorFields = z.infer<typeof PublicErrorFieldsSchema>;
