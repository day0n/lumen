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

export async function submitArkVideoTask(
  payload: Record<string, unknown>,
  signal?: AbortSignal,
): Promise<string> {
  const response = await fetch(`${getArkBaseUrl()}/contents/generations/tasks`, {
    method: 'POST',
    headers: getArkHeaders(),
    body: JSON.stringify(payload),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
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
  const response = await fetch(`${getArkBaseUrl()}/contents/generations/tasks/${taskId}`, {
    headers: getArkHeaders(),
    signal,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`volcengine ark poll failed (${response.status}): ${text}`);
  }

  return (await response.json()) as ArkVideoTaskResult;
}

export function extractArkVideoUrl(result: ArkVideoTaskResult): string | null {
  const videoUrl = result.content?.video_url;
  return typeof videoUrl === 'string' && videoUrl.trim() ? videoUrl.trim() : null;
}
