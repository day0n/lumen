'use client';

export interface UploadProgressEvent {
  loaded: number;
  percent: number;
  total: number;
}

export type UploadProgressCallback = (event: UploadProgressEvent) => void;

type UploadErrorCode = 'aborted' | 'http_error' | 'network_error' | 'timeout';

export class DirectUploadError extends Error {
  code: UploadErrorCode;
  retryable: boolean;
  status?: number;

  constructor(args: {
    code: UploadErrorCode;
    message: string;
    retryable: boolean;
    status?: number;
  }) {
    super(args.message);
    this.name = 'DirectUploadError';
    this.code = args.code;
    this.retryable = args.retryable;
    this.status = args.status;
  }
}

const MIN_UPLOAD_TIMEOUT_MS = 60_000;
const MAX_UPLOAD_TIMEOUT_MS = 15 * 60_000;
const MIN_UPLOAD_SPEED_BYTES_PER_SECOND = 30_000;

export function getUploadTimeoutMs(fileSize: number): number {
  return Math.min(
    MAX_UPLOAD_TIMEOUT_MS,
    Math.max(
      MIN_UPLOAD_TIMEOUT_MS,
      Math.ceil((fileSize / MIN_UPLOAD_SPEED_BYTES_PER_SECOND) * 1000),
    ),
  );
}

function uploadFileWithXhr(args: {
  file: File;
  firstProgressTimeoutMs?: number;
  headers?: Record<string, string>;
  method: 'POST' | 'PUT';
  onProgress?: UploadProgressCallback;
  signal?: AbortSignal;
  timeoutMs?: number;
  url: string;
}): Promise<{ responseText: string; status: number }> {
  return new Promise((resolve, reject) => {
    if (args.signal?.aborted) {
      reject(
        new DirectUploadError({ code: 'aborted', message: 'Upload aborted', retryable: false }),
      );
      return;
    }

    const xhr = new XMLHttpRequest();
    xhr.timeout = args.timeoutMs ?? getUploadTimeoutMs(args.file.size);
    let settled = false;
    let firstProgressTimer: number | undefined;

    const cleanupSignalListener = () => {
      args.signal?.removeEventListener('abort', handleAbort);
    };

    const cleanup = () => {
      cleanupSignalListener();
      if (firstProgressTimer) window.clearTimeout(firstProgressTimer);
    };

    const resolveOnce = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({ responseText: xhr.responseText, status: xhr.status });
    };

    const rejectOnce = (error: DirectUploadError) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    const handleAbort = () => {
      if (!settled) xhr.abort();
    };

    args.signal?.addEventListener('abort', handleAbort);
    if (args.firstProgressTimeoutMs) {
      firstProgressTimer = window.setTimeout(() => {
        if (settled) return;
        xhr.abort();
        rejectOnce(
          new DirectUploadError({
            code: 'timeout',
            message: 'Upload did not start',
            retryable: true,
          }),
        );
      }, args.firstProgressTimeoutMs);
    }
    xhr.upload.onprogress = (event) => {
      if (!event.lengthComputable) return;
      if (firstProgressTimer) {
        window.clearTimeout(firstProgressTimer);
        firstProgressTimer = undefined;
      }
      const percent = Math.max(1, Math.min(99, Math.round((event.loaded / event.total) * 100)));
      args.onProgress?.({ loaded: event.loaded, percent, total: event.total });
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        args.onProgress?.({ loaded: args.file.size, percent: 100, total: args.file.size });
        resolveOnce();
        return;
      }

      rejectOnce(
        new DirectUploadError({
          code: 'http_error',
          message: `Upload failed with status ${xhr.status}`,
          retryable: xhr.status === 403 || xhr.status >= 500,
          status: xhr.status,
        }),
      );
    };
    xhr.onerror = () => {
      rejectOnce(
        new DirectUploadError({
          code: 'network_error',
          message: 'Upload network error',
          retryable: true,
        }),
      );
    };
    xhr.onabort = () => {
      rejectOnce(
        new DirectUploadError({ code: 'aborted', message: 'Upload aborted', retryable: false }),
      );
    };
    xhr.ontimeout = () => {
      rejectOnce(
        new DirectUploadError({
          code: 'timeout',
          message: 'Upload timeout',
          retryable: true,
        }),
      );
    };

    xhr.open(args.method, args.url);
    for (const [name, value] of Object.entries(args.headers ?? {})) {
      if (value) xhr.setRequestHeader(name, value);
    }
    xhr.send(args.file);
  });
}

export async function uploadToObjectStorage(args: {
  file: File;
  firstProgressTimeoutMs?: number;
  headers?: Record<string, string>;
  onProgress?: UploadProgressCallback;
  signal?: AbortSignal;
  timeoutMs?: number;
  uploadUrl: string;
}): Promise<void> {
  await uploadFileWithXhr({
    file: args.file,
    firstProgressTimeoutMs: args.firstProgressTimeoutMs,
    headers: args.headers,
    method: 'PUT',
    onProgress: args.onProgress,
    signal: args.signal,
    timeoutMs: args.timeoutMs,
    url: args.uploadUrl,
  });
}

export function uploadToAppServer(args: {
  file: File;
  firstProgressTimeoutMs?: number;
  headers?: Record<string, string>;
  onProgress?: UploadProgressCallback;
  signal?: AbortSignal;
  timeoutMs?: number;
  uploadUrl: string;
}): Promise<{ responseText: string; status: number }> {
  return uploadFileWithXhr({
    file: args.file,
    firstProgressTimeoutMs: args.firstProgressTimeoutMs,
    headers: args.headers,
    method: 'POST',
    onProgress: args.onProgress,
    signal: args.signal,
    timeoutMs: args.timeoutMs,
    url: args.uploadUrl,
  });
}
