import {
  type NodeType,
  PUBLIC_ERROR_CODES,
  PUBLIC_ERROR_I18N_KEYS,
  type PublicErrorFields,
  type PublicErrorName,
} from '@lumen/shared/domain';
import { isWorkflowCancelledError, throwIfCancelled } from './cancellation.js';

const MAX_MEDIA_MODEL_ATTEMPTS = 2;

const PUBLIC_ERROR_MESSAGES = {
  content_blocked: 'Generation failed because the content did not pass safety review.',
  real_person_detected:
    'Generation failed because the input image appears to contain a real person.',
  model_execution_failed: 'Generation failed. Please try again.',
} as const satisfies Record<PublicErrorName, string>;

const REAL_PERSON_PATTERN =
  /real.?person|PrivacyInformation|InputImageSensitiveContentDetected|真人|真实人物|真人图片/i;

const CONTENT_BLOCKED_PATTERN =
  /content.*flag|content.*checker|content.?safety|\bsafety\b|safety.?filter|safety.?check|safety.?rating|block(?:ed|ing|reason)?|prohibited|unsafe|content.policy|policy|violat|moderation|review.*fail|audit.*fail|not approved|not pass|failed.*review|can't assist|cannot assist|not able to help|审核|未通过|不通过/i;

const NON_RETRYABLE_LOCAL_PATTERN =
  /unsupported .*model|unsupported .*input.*format|unsupported .*reference.*format|is required for|URL is not an image|failed to fetch (image reference|veo input image)/i;

export interface ClassifiedPublicError extends PublicErrorFields {
  errorCode?: number;
  errorName: PublicErrorName;
  errorI18nKey: string;
  publicMessage: string;
  rawMessage: string;
}

export class PublicWorkflowError extends Error {
  readonly errorCode?: number;
  readonly errorName: PublicErrorName;
  readonly errorI18nKey: string;
  readonly retryable: boolean;
  readonly attempts: number;
  readonly rawMessage: string;

  constructor(classified: ClassifiedPublicError) {
    super(classified.publicMessage);
    this.name = 'PublicWorkflowError';
    this.errorCode = classified.errorCode;
    this.errorName = classified.errorName;
    this.errorI18nKey = classified.errorI18nKey;
    this.retryable = classified.retryable ?? false;
    this.attempts = classified.attempts ?? 1;
    this.rawMessage = classified.rawMessage;
  }
}

export function classifyMediaModelError(
  error: unknown,
  opts: { attempts?: number; retryable?: boolean } = {},
): ClassifiedPublicError {
  const rawMessage = errorToText(error);
  const errorName = classifyPublicErrorName(rawMessage);
  return {
    errorCode: PUBLIC_ERROR_CODES[errorName],
    errorName,
    errorI18nKey: PUBLIC_ERROR_I18N_KEYS[errorName],
    publicMessage: PUBLIC_ERROR_MESSAGES[errorName],
    rawMessage,
    retryable: opts.retryable ?? false,
    attempts: opts.attempts ?? 1,
  };
}

export function publicErrorFields(error: unknown): PublicErrorFields {
  if (error instanceof PublicWorkflowError) {
    return {
      errorCode: error.errorCode,
      errorName: error.errorName,
      errorI18nKey: error.errorI18nKey,
      retryable: error.retryable,
      attempts: error.attempts,
    };
  }
  return {};
}

export function publicErrorRawMessage(error: unknown): string | undefined {
  if (error instanceof PublicWorkflowError) return error.rawMessage;
  return undefined;
}

export function publicErrorMessage(error: unknown): string {
  if (error instanceof PublicWorkflowError) return error.message;
  const classified = classifyMediaModelError(error);
  return classified.publicMessage;
}

export async function executeMediaModelWithRetry<T>(input: {
  // All node types go through this wrapper so the retry policy and
  // error-classification (i.e. mapping raw provider exceptions to
  // PublicWorkflowError with errorCode / i18n key) is applied uniformly.
  // Previously only image/video were wrapped, leaving raw error text from
  // text/audio/composition handlers leaking to the browser. The
  // `nodeType` field is reported for telemetry only — retry behaviour is
  // identical across types.
  nodeType: NodeType;
  modelId: string;
  signal?: AbortSignal;
  execute: () => Promise<T>;
  maxAttempts?: number;
}): Promise<T> {
  const maxAttempts = input.maxAttempts ?? MAX_MEDIA_MODEL_ATTEMPTS;
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    throwIfCancelled(input.signal);
    try {
      return await input.execute();
    } catch (error) {
      if (isWorkflowCancelledError(error) || input.signal?.aborted) throw error;

      lastError = error;
      const retryable = attempt < maxAttempts && !isNonRetryableLocalError(error);
      if (!retryable) {
        throw new PublicWorkflowError(
          classifyMediaModelError(error, {
            attempts: attempt,
            retryable: false,
          }),
        );
      }
    }
  }

  throw new PublicWorkflowError(
    classifyMediaModelError(lastError, {
      attempts: maxAttempts,
      retryable: false,
    }),
  );
}

function classifyPublicErrorName(rawMessage: string): PublicErrorName {
  if (REAL_PERSON_PATTERN.test(rawMessage)) return 'real_person_detected';
  if (CONTENT_BLOCKED_PATTERN.test(rawMessage)) return 'content_blocked';
  return 'model_execution_failed';
}

function isNonRetryableLocalError(error: unknown): boolean {
  return NON_RETRYABLE_LOCAL_PATTERN.test(errorToText(error));
}

function errorToText(error: unknown): string {
  if (error instanceof Error) {
    const pieces = [error.message, error.name, error.stack].filter(Boolean);
    const cause = (error as Error & { cause?: unknown }).cause;
    if (cause) pieces.push(safeStringify(cause));
    return pieces.join('\n');
  }
  return safeStringify(error);
}

function safeStringify(value: unknown): string {
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
