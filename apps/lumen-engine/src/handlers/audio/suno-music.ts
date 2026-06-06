import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { config } from '../../config.js';
import {
  WorkflowCancelledError,
  cancellationReason,
  sleep,
  throwIfCancelled,
} from '../../engine/cancellation.js';
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
  const durationSeconds = readDurationSetting(settings);

  const taskId = await submitMusicTask({
    apiKey,
    prompt: prompt.slice(0, PROMPT_MAX_LEN),
    model,
    instrumental,
    signal,
  });

  logger.info({ taskId, instrumental, model }, 'suno-music task submitted');

  const audioUrl = await pollMusicResult(apiKey, taskId, signal);

  if (durationSeconds !== null) {
    const trimmedAudioUrl = await trimGeneratedAudio(audioUrl, durationSeconds, signal);
    logger.info(
      { taskId, audioUrl, trimmedAudioUrl, durationSeconds },
      'suno-music audio generated and trimmed',
    );
    return { type: 'audio', value: trimmedAudioUrl };
  }

  logger.info({ taskId, audioUrl }, 'suno-music audio generated');

  return { type: 'audio', value: audioUrl };
}

async function trimGeneratedAudio(
  sourceUrl: string,
  durationSeconds: number,
  signal?: AbortSignal,
): Promise<string> {
  throwIfCancelled(signal);
  const workdir = await mkdtemp(join(tmpdir(), 'lumen-suno-music-'));
  const inputPath = await downloadAudio(sourceUrl, workdir, signal);
  const outputPath = join(workdir, 'bgm-trimmed.m4a');
  const duration = clampNumber(durationSeconds, 0.5, config.VIDEO_EDIT_MAX_DURATION_SECONDS);

  await runCommand(
    config.VIDEO_EDIT_FFMPEG_PATH,
    [
      '-y',
      '-hide_banner',
      '-i',
      inputPath,
      '-t',
      formatSeconds(duration),
      '-vn',
      '-c:a',
      'aac',
      '-b:a',
      '160k',
      '-movflags',
      '+faststart',
      outputPath,
    ],
    5 * 60 * 1000,
    signal,
  );

  return pathToFileURL(outputPath).toString();
}

async function downloadAudio(url: string, workdir: string, signal?: AbortSignal): Promise<string> {
  throwIfCancelled(signal);
  if (!isHttpUrl(url)) {
    throw new Error('suno-music returned an unsupported audio URL');
  }

  const response = await fetch(url, {
    redirect: 'follow',
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      accept: 'audio/*,*/*',
    },
    signal: timeoutSignal(300_000, signal),
  });

  if (!response.ok) {
    throw new Error(`failed to download suno audio: HTTP ${response.status}`);
  }

  const bytes = Buffer.from(await response.arrayBuffer());
  throwIfCancelled(signal);
  const maxBytes = config.VIDEO_EDIT_MAX_INPUT_MB * 1024 * 1024;
  if (bytes.byteLength > maxBytes) {
    throw new Error(
      `suno audio is too large (${(bytes.byteLength / 1024 / 1024).toFixed(1)}MB > ${config.VIDEO_EDIT_MAX_INPUT_MB}MB)`,
    );
  }

  const contentType = response.headers.get('content-type')?.split(';')[0]?.trim() ?? '';
  const extension = audioExtensionFor(contentType, url);
  const path = join(workdir, `bgm-source.${extension}`);
  await writeFile(path, bytes);
  return path;
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

function readDurationSetting(settings: Record<string, unknown>): number | null {
  const value = settings.durationSeconds;
  const parsed =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
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

function audioExtensionFor(contentType: string, url: string): string {
  switch (contentType.toLowerCase()) {
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/ogg':
      return 'ogg';
    case 'audio/aac':
      return 'aac';
    case 'audio/mp4':
    case 'audio/x-m4a':
      return 'm4a';
    case 'audio/flac':
      return 'flac';
  }

  try {
    const ext = new URL(url).pathname.split('.').pop()?.toLowerCase();
    if (ext && ['mp3', 'wav', 'ogg', 'aac', 'm4a', 'flac'].includes(ext)) return ext;
  } catch {
    // Fall through to mp3.
  }
  return 'mp3';
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function timeoutSignal(timeoutMs: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMs);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function clampNumber(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(value, max));
}

function formatSeconds(value: number): string {
  return Math.max(0, value)
    .toFixed(3)
    .replace(/\.?0+$/, '');
}

function runCommand(
  command: string,
  args: string[],
  timeoutMs = 60_000,
  signal?: AbortSignal,
): Promise<{ stdout: string; stderr: string }> {
  throwIfCancelled(signal);
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      cleanup();
      reject(new WorkflowCancelledError(cancellationReason(signal)));
    };

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };

    signal?.addEventListener('abort', onAbort, { once: true });

    timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill('SIGKILL');
      cleanup();
      reject(new Error(`${command} timed out after ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      cleanup();
      const out = Buffer.concat(stdout).toString('utf8');
      const err = Buffer.concat(stderr).toString('utf8');
      if (code === 0) {
        resolve({ stdout: out, stderr: err });
        return;
      }
      reject(new Error(`${command} exited with code ${code}: ${err.slice(-2000)}`));
    });
  });
}
