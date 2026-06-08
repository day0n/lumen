import { config } from '../config.js';
import { logger } from '../utils/logger.js';

export type ArkTaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | string;

export interface ArkVideoTaskResult {
  id: string;
  status: ArkTaskStatus;
  content?: {
    video_url?: string;
  };
  error?: {
    message?: string;
    code?: string;
  };
}

const MIN_REQUEST_INTERVAL_MS = 12_000;
const RATE_LIMIT_RETRY_MS = 65_000;
const MAX_RATE_LIMIT_ATTEMPTS = 4;
const LOG_BODY_LIMIT = 500;

let nextRequestAt = 0;
let requestQueue: Promise<void> = Promise.resolve();

function getArkBaseUrl(): string {
  const raw = config.ARK_BASE_URL.trim().replace(/\/$/, '');
  return raw.endsWith('/api/v3') ? raw : `${raw}/api/v3`;
}

function getArkHeaders(): Record<string, string> {
  const apiKey = config.ARK_API_KEY.trim();
  if (!apiKey) {
    throw new Error('ARK_API_KEY is required for Seedance 1.5 Pro');
  }
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${apiKey}`,
  };
}

async function reserveRequestSlot(signal?: AbortSignal): Promise<void> {
  let releaseQueue: () => void = () => {};
  const previous = requestQueue;
  requestQueue = new Promise((resolve) => {
    releaseQueue = resolve;
  });

  await previous;
  try {
    const waitMs = Math.max(0, nextRequestAt - Date.now());
    if (waitMs > 0) {
      await delay(waitMs, signal);
    }
    nextRequestAt = Date.now() + MIN_REQUEST_INTERVAL_MS;
  } finally {
    releaseQueue();
  }
}

async function fetchArk(
  path: string,
  init: RequestInit,
  signal?: AbortSignal,
): Promise<{ response: Response; bodyText?: string }> {
  for (let attempt = 1; attempt <= MAX_RATE_LIMIT_ATTEMPTS; attempt += 1) {
    await reserveRequestSlot(signal);
    const response = await fetch(`${getArkBaseUrl()}${path}`, { ...init, signal });

    if (response.status !== 429 || attempt === MAX_RATE_LIMIT_ATTEMPTS) {
      return { response };
    }

    const bodyText = await response.text();
    const retryMs = readRetryDelayMs(response, attempt);
    logger.warn(
      {
        attempt,
        retryMs,
        body: bodyText.slice(0, LOG_BODY_LIMIT),
      },
      'video provider rate limit hit; retrying request',
    );
    await delay(retryMs, signal);
  }

  throw new Error('video provider request retry loop exhausted');
}

export async function submitArkVideoTask(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const { response, bodyText } = await fetchArk(
    '/contents/generations/tasks',
    {
      method: 'POST',
      headers: getArkHeaders(),
      body: JSON.stringify(payload),
    },
    signal,
  );

  if (!response.ok) {
    const text = bodyText ?? (await response.text());
    throw new Error(`volcengine ark submit failed (${response.status}): ${text}`);
  }

  const body = (await response.json()) as ArkVideoTaskResult;
  if (!body.id) {
    throw new Error('volcengine ark submit returned no task id');
  }

  logger.info({ taskId: body.id, status: body.status }, 'volcengine ark video task submitted');
  return body.id;
}

export async function pollArkVideoTask(
  taskId: string,
  signal?: AbortSignal,
): Promise<ArkVideoTaskResult> {
  const { response, bodyText } = await fetchArk(
    `/contents/generations/tasks/${taskId}`,
    {
      headers: getArkHeaders(),
    },
    signal,
  );

  if (!response.ok) {
    const text = bodyText ?? (await response.text());
    throw new Error(`volcengine ark poll failed (${response.status}): ${text}`);
  }

  return (await response.json()) as ArkVideoTaskResult;
}

export function extractArkVideoUrl(result: ArkVideoTaskResult): string | null {
  const videoUrl = result.content?.video_url;
  return typeof videoUrl === 'string' && videoUrl.trim() ? videoUrl.trim() : null;
}

function readRetryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  const retryAfterSeconds = retryAfter ? Number(retryAfter) : Number.NaN;
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return Math.min(retryAfterSeconds * 1000, 180_000);
  }
  return Math.min(RATE_LIMIT_RETRY_MS * attempt, 180_000);
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  if (signal?.aborted) return Promise.reject(new Error('request aborted'));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('request aborted'));
    };

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}
