import type { PublicErrorName } from '@lumen/shared/domain';

type Translate = (key: string) => string;

const CODE_I18N_KEYS: Record<number, string> = {
  3005: 'canvas.errorCodes.contentBlocked',
  4007: 'canvas.errorCodes.realPersonDetected',
};

const NAME_I18N_KEYS: Record<PublicErrorName, string> = {
  model_execution_failed: 'canvas.errorCodes.runFailed',
  content_blocked: 'canvas.errorCodes.contentBlocked',
  real_person_detected: 'canvas.errorCodes.realPersonDetected',
};

export function formatPublicWorkflowError(
  source: Record<string, unknown>,
  t: Translate,
  fallback?: string | null,
): string | null {
  const key = resolveErrorI18nKey(source);
  if (key) {
    const message = t(key);
    if (message && message !== key) return message;
  }
  return fallback?.trim() || null;
}

function resolveErrorI18nKey(source: Record<string, unknown>): string | null {
  const explicitKey = readString(source.errorI18nKey) ?? readString(source.error_i18n_key);
  if (explicitKey?.startsWith('canvas.errorCodes.')) return explicitKey;

  const code = readNumber(source.errorCode) ?? readNumber(source.error_code);
  if (code !== null && CODE_I18N_KEYS[code]) return CODE_I18N_KEYS[code];

  const name = readPublicErrorName(source.errorName) ?? readPublicErrorName(source.error_name);
  return name ? NAME_I18N_KEYS[name] : null;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readPublicErrorName(value: unknown): PublicErrorName | null {
  return value === 'content_blocked' ||
    value === 'real_person_detected' ||
    value === 'model_execution_failed'
    ? value
    : null;
}
