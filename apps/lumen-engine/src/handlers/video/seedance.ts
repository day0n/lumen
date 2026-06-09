import { extractArkVideoUrl, pollArkVideoTask, submitArkVideoTask } from '../../clients/volcArk.js';
import { config } from '../../config.js';
import { sleep, throwIfCancelled } from '../../engine/cancellation.js';
import type { ResolvedInput } from '../../engine/resolver.js';
import { logger } from '../../utils/logger.js';
import type { ExecutionContext, NodeOutput } from '../base.js';

const SEEDANCE_ASPECT_RATIOS = new Set(['16:9', '9:16', '1:1', '4:3', '3:4', '21:9']);
const SEEDANCE_RESOLUTIONS = new Set(['480p', '720p', '1080p']);
const SEEDANCE_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12] as const;

// Hard ceiling for the polling loop. Without this, an Ark Seedance task
// stuck in `queued`/`running` jams the consumer (COUNT=1, BLOCK) — every
// other workflow on the same stream is starved until this one completes.
// 30 minutes is well past any legitimate generation; mirrors the Veo
// handler. The audio handler `suno-music` already uses 6 minutes.
const SEEDANCE_MAX_POLL_MS = 30 * 60 * 1000;
const SEEDANCE_POLL_INTERVAL_MS = 8_000;

export async function execute(
  input: ResolvedInput,
  settings: Record<string, unknown>,
  context: ExecutionContext = {},
): Promise<NodeOutput> {
  const { signal } = context;
  throwIfCancelled(signal);

  const endpoint = config.ARK_SEEDANCE_ENDPOINT.trim();
  if (!endpoint) {
    throw new Error('ARK_SEEDANCE_ENDPOINT is required for Seedance 1.5 Pro');
  }

  const aspectRatio = readAspectRatio(settings);
  const resolution = readResolution(settings);
  const duration = readDuration(settings);
  const prompt = input.prompt.trim() || 'Generate a cinematic video.';
  const imageUrls = await resolveImageUrls(input, signal);

  const textCommand = `--ratio ${aspectRatio} --rs ${resolution} --fps 24`;
  const textValue = `${prompt} ${textCommand}`;

  const content: Record<string, unknown>[] = [{ type: 'text', text: textValue }];

  if (imageUrls.length >= 1) {
    const firstItem: Record<string, unknown> = {
      type: 'image_url',
      image_url: { url: imageUrls[0] },
    };
    if (imageUrls.length >= 2) firstItem.role = 'start';
    content.push(firstItem);
  }
  if (imageUrls.length >= 2) {
    content.push({
      type: 'image_url',
      image_url: { url: imageUrls[1] },
      role: 'end',
    });
  }

  const payload: Record<string, unknown> = {
    model: endpoint,
    content,
    duration,
  };

  logger.info(
    {
      endpoint,
      aspectRatio,
      resolution,
      duration,
      hasImage: imageUrls.length > 0,
      hasLastFrame: imageUrls.length > 1,
    },
    'starting seedance 1.5 pro video generation',
  );

  const taskId = await submitArkVideoTask(payload, signal);
  throwIfCancelled(signal);

  const startedAt = Date.now();
  let result = await pollArkVideoTask(taskId, signal);
  while (result.status === 'queued' || result.status === 'running') {
    if (Date.now() - startedAt > SEEDANCE_MAX_POLL_MS) {
      throw new Error(
        `seedance 1.5 pro polling timed out after ${Math.round(SEEDANCE_MAX_POLL_MS / 60_000)} minutes (last status=${result.status})`,
      );
    }
    logger.info({ taskId, status: result.status }, 'waiting for seedance 1.5 pro...');
    await sleep(SEEDANCE_POLL_INTERVAL_MS, signal);
    result = await pollArkVideoTask(taskId, signal);
    throwIfCancelled(signal);
  }

  if (result.status === 'failed') {
    const message = result.error?.message ?? 'seedance 1.5 pro task failed';
    throw new Error(message);
  }

  const videoUrl = extractArkVideoUrl(result);
  if (!videoUrl) {
    throw new Error('seedance 1.5 pro returned no video url');
  }

  logger.info({ taskId, videoUrl }, 'seedance 1.5 pro video generated');
  return { type: 'video', value: videoUrl };
}

function readAspectRatio(settings: Record<string, unknown>): string {
  const value =
    readStringSetting(settings, 'aspectRatio') ?? readStringSetting(settings, 'aspect_ratio');
  return value && SEEDANCE_ASPECT_RATIOS.has(value) ? value : '16:9';
}

function readResolution(settings: Record<string, unknown>): string {
  const value = readStringSetting(settings, 'resolution');
  return value && SEEDANCE_RESOLUTIONS.has(value) ? value : '1080p';
}

function readDuration(settings: Record<string, unknown>): number {
  const raw = settings.duration;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return SEEDANCE_DURATIONS.includes(value as (typeof SEEDANCE_DURATIONS)[number]) ? value : 4;
}

function readStringSetting(settings: Record<string, unknown>, key: string): string | null {
  const value = settings[key];
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

async function resolveImageUrls(input: ResolvedInput, signal?: AbortSignal): Promise<string[]> {
  const candidates = [input.image, input.lastFrameImage, ...input.images].filter(
    (value): value is string => typeof value === 'string' && value.trim().length > 0,
  );
  const unique = candidates.filter((value, index) => candidates.indexOf(value) === index);
  const resolved: string[] = [];

  for (const source of unique.slice(0, 2)) {
    resolved.push(await resolveImageUrl(source, signal));
  }

  return resolved;
}

async function resolveImageUrl(source: string, _signal?: AbortSignal): Promise<string> {
  const trimmed = source.trim();
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }

  if (trimmed.startsWith('data:image/')) {
    return trimmed;
  }

  throw new Error('unsupported seedance input image format');
}
