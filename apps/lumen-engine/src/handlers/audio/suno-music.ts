import { config } from '../../config.js';
import { sleep, throwIfCancelled } from '../../engine/cancellation.js';
import type { ResolvedInput } from '../../engine/resolver.js';
import { logger } from '../../utils/logger.js';
import type { ExecutionContext, NodeOutput } from '../base.js';

const KIE_BASE_URL = 'https://api.kie.ai/api/v1';
const SUBMIT_ENDPOINT = '/generate';
const POLL_ENDPOINT = '/generate/record-info';
const MAX_POLL_MS = 6 * 60 * 1000; // 音乐生成通常 1-3 分钟，封顶 6 分钟
const PROMPT_MAX_LEN = 500;
// KIE 的 /generate 强制要求 callBackUrl 字段存在；我们用轮询拿结果，不依赖回调，
// 所以这里只需提供一个合法 URL 占位（KIE 回调拿到 404 也无影响）。
const DEFAULT_CALLBACK_URL = 'https://lumenstudio.tech/api/webhooks/kie';

const SUCCESS_STATUSES = new Set([
  'success',
  'succeeded',
  'complete',
  'completed',
  'first_success',
]);
const FAILED_STATUSES = new Set([
  'fail',
  'failed',
  'failure',
  'error',
  'create_task_failed',
  'generate_audio_failed',
  'callback_exception',
  'sensitive_word_error',
]);

interface SunoTrack {
  audioUrl?: string;
  audio_url?: string;
  sourceAudioUrl?: string;
  streamAudioUrl?: string;
}

export async function execute(
  input: ResolvedInput,
  settings: Record<string, unknown>,
  context: ExecutionContext = {},
): Promise<NodeOutput> {
  const { signal } = context;
  throwIfCancelled(signal);
  const apiKey = config.KIE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error('suno-music requires KIE_API_KEY to be configured on the engine');
  }

  const prompt = input.prompt?.trim();
  if (!prompt) {
    throw new Error('suno-music requires a non-empty prompt');
  }

  const instrumental = readBooleanSetting(settings, 'instrumental', 'make_instrumental');
  const model = readStringSetting(settings, 'suno_model') ?? 'V5';

  const taskId = await submitMusicTask({
    apiKey,
    prompt: prompt.slice(0, PROMPT_MAX_LEN),
    model,
    instrumental,
    signal,
  });

  logger.info({ taskId, instrumental, model }, 'suno-music task submitted');

  const audioUrl = await pollMusicResult(apiKey, taskId, signal);

  logger.info({ taskId, audioUrl }, 'suno-music audio generated');

  return { type: 'audio', value: audioUrl };
}

async function submitMusicTask(args: {
  apiKey: string;
  prompt: string;
  model: string;
  instrumental: boolean;
  signal?: AbortSignal;
}): Promise<string> {
  throwIfCancelled(args.signal);
  const callBackUrl = config.KIE_CALLBACK_URL?.trim() || DEFAULT_CALLBACK_URL;
  const response = await fetch(`${KIE_BASE_URL}${SUBMIT_ENDPOINT}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${args.apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      prompt: args.prompt,
      model: args.model,
      instrumental: args.instrumental,
      customMode: false,
      callBackUrl,
    }),
    signal: args.signal,
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`suno-music submit failed (${response.status}): ${errText}`);
  }

  const body = (await response.json()) as Record<string, unknown>;
  const code = body.code as number | undefined;
  if (code !== undefined && code !== 200 && code !== 0) {
    const msg = (body.msg ?? body.message ?? 'unknown error') as string;
    throw new Error(`suno-music submit error (${code}): ${msg}`);
  }

  const data = (body.data ?? body) as Record<string, unknown>;
  const taskId = (data.taskId ?? data.task_id ?? data.id) as string | undefined;
  if (!taskId) {
    throw new Error(`suno-music submit returned no taskId: ${JSON.stringify(body).slice(0, 300)}`);
  }
  return taskId;
}

async function pollMusicResult(
  apiKey: string,
  taskId: string,
  signal?: AbortSignal,
): Promise<string> {
  const start = Date.now();

  // 初始等待，避免任务尚未入库时立即轮询拿到 422。
  await sleep(3000, signal);

  while (true) {
    throwIfCancelled(signal);
    const elapsed = Date.now() - start;
    if (elapsed > MAX_POLL_MS) {
      throw new Error(`suno-music timed out after ${Math.round(MAX_POLL_MS / 1000)}s`);
    }

    const pollUrl = new URL(`${KIE_BASE_URL}${POLL_ENDPOINT}`);
    pollUrl.searchParams.set('taskId', taskId);

    const response = await fetch(pollUrl.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal,
    });

    if (response.status === 429) {
      logger.warn({ taskId }, 'suno-music poll rate limited, backing off 30s');
      await sleep(30_000, signal);
      continue;
    }

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`suno-music poll failed (${response.status}): ${errText}`);
    }

    const body = (await response.json()) as Record<string, unknown>;
    const code = body.code as number | undefined;
    const data = (body.data ?? body) as Record<string, unknown>;

    // KIE 在任务刚入库前可能返回 422 "recordInfo is null"，视为未就绪继续轮询。
    if (code !== undefined && code !== 200 && code !== 0) {
      const msg = (body.msg ?? body.message ?? '') as string;
      if (code === 422 && msg.includes('recordInfo is null')) {
        await sleep(pollInterval(elapsed), signal);
        continue;
      }
      throw new Error(`suno-music poll error (${code}): ${msg || 'unknown error'}`);
    }

    const rawStatus = ((data.status ?? data.state) as string | undefined) ?? '';
    const status = rawStatus.toLowerCase();

    if (FAILED_STATUSES.has(status)) {
      const failMsg = (data.errorMessage ??
        data.failMsg ??
        data.error ??
        'unknown error') as string;
      throw new Error(`suno-music task failed (${rawStatus}): ${failMsg}`);
    }

    const audioUrl = extractAudioUrl(data);
    if (audioUrl && (SUCCESS_STATUSES.has(status) || status === '')) {
      return audioUrl;
    }

    logger.info({ taskId, status: rawStatus || 'pending' }, 'suno-music still generating');
    await sleep(pollInterval(elapsed), signal);
  }
}

function extractAudioUrl(data: Record<string, unknown>): string | null {
  const response = data.response as Record<string, unknown> | undefined;
  const sunoData = response?.sunoData ?? data.sunoData;
  if (Array.isArray(sunoData) && sunoData.length > 0) {
    const first = sunoData[0] as SunoTrack;
    const url = first.audioUrl ?? first.audio_url ?? first.sourceAudioUrl;
    if (typeof url === 'string' && url.trim()) return url.trim();
  }
  return null;
}

function pollInterval(elapsedMs: number): number {
  if (elapsedMs < 30_000) return 3000;
  if (elapsedMs < 120_000) return 5000;
  return 10_000;
}

function readStringSetting(settings: Record<string, unknown>, key: string): string | null {
  const value = settings[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readBooleanSetting(settings: Record<string, unknown>, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = settings[key];
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      const lowered = value.trim().toLowerCase();
      if (lowered === 'true') return true;
      if (lowered === 'false') return false;
    }
  }
  return false;
}
