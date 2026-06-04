export const CANCEL_CHANNEL = 'lumen:flow:cancels';
export const CANCEL_KEY_PREFIX = 'lumen:flow:cancel:';

export class WorkflowCancelledError extends Error {
  constructor(message = 'cancelled by user') {
    super(message);
    this.name = 'WorkflowCancelledError';
  }
}

export function cancellationReason(signal?: AbortSignal): string {
  const reason = signal?.reason;
  if (reason instanceof Error && reason.message) return reason.message;
  if (typeof reason === 'string' && reason.trim()) return reason.trim();
  return 'cancelled by user';
}

export function isWorkflowCancelledError(value: unknown): boolean {
  return (
    value instanceof WorkflowCancelledError ||
    (typeof DOMException !== 'undefined' &&
      value instanceof DOMException &&
      value.name === 'AbortError')
  );
}

export function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new WorkflowCancelledError(cancellationReason(signal));
}

export async function withCancellation<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  throwIfCancelled(signal);

  let abortHandler: (() => void) | null = null;
  const abortPromise = new Promise<never>((_, reject) => {
    abortHandler = () => reject(new WorkflowCancelledError(cancellationReason(signal)));
    signal.addEventListener('abort', abortHandler, { once: true });
  });

  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    if (abortHandler) signal.removeEventListener('abort', abortHandler);
  }
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (!signal) return new Promise((resolve) => setTimeout(resolve, ms));
  throwIfCancelled(signal);

  return new Promise((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      cleanup();
      reject(new WorkflowCancelledError(cancellationReason(signal)));
    };
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    };
    timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
