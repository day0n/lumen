import { getGoogleClient } from '../../clients/google.js';
import { sleep, throwIfCancelled } from '../../engine/cancellation.js';
import type { ResolvedInput } from '../../engine/resolver.js';
import { logger } from '../../utils/logger.js';
import type { ExecutionContext, NodeOutput } from '../base.js';

interface VeoImage {
  gcsUri?: string;
  imageBytes?: string;
  mimeType?: string;
}

interface GeneratedVideo {
  video?: {
    gcsUri?: string;
    mimeType?: string;
    uri?: string;
    videoBytes?: string;
    bytesBase64Encoded?: string;
  };
}

interface VideoGenerationResult {
  response?: {
    generatedVideos?: GeneratedVideo[];
  };
  result?: {
    generatedVideos?: GeneratedVideo[];
  };
}

const VEO_ASPECT_RATIOS = new Set(['16:9', '9:16']);

// Hard ceiling for the long-poll. Without this, a Veo task that gets
// stuck in `running` server-side jams the consumer (COUNT=1, BLOCK)
// indefinitely — every other workflow waits behind it. 30 minutes
// covers the slowest legitimate generations (1080p with last-frame
// conditioning) with margin; the audio handler `suno-music` already
// uses a 6-minute version of the same pattern.
const VEO_MAX_POLL_MS = 30 * 60 * 1000;
const VEO_POLL_INTERVAL_MS = 10_000;

export async function execute(
  input: ResolvedInput,
  settings: Record<string, unknown>,
  context: ExecutionContext = {},
): Promise<NodeOutput> {
  const { signal } = context;
  throwIfCancelled(signal);
  const client = getGoogleClient();

  const aspectRatio = readAspectRatio(settings);
  const resolution = readStringSetting(settings, 'resolution');
  // veo-3.1 text_to_video 仅支持 [4, 6, 8] 秒，向上吸附到最近的合法值；
  // 1080p / 4k 仅支持 8s（Veo 额外约束），其余尊重用户选择并 clamp。
  const requestedDuration = readNumberSetting(settings, 'duration') ?? 8;
  const supportedDurations = [4, 6, 8] as const;
  const clampedDuration = supportedDurations.find((value) => value >= requestedDuration) ?? 8;
  const durationSeconds = resolution === '1080p' || resolution === '4k' ? 8 : clampedDuration;
  const imageSource = firstImage(input.image, input.images);
  const lastFrameSource = nextImage(input.lastFrameImage, input.images, imageSource);
  const image = await toVeoImage(imageSource, signal);
  const lastFrame = image ? await toVeoImage(lastFrameSource, signal) : null;

  logger.info(
    {
      aspectRatio,
      durationSeconds,
      resolution: resolution ?? '720p',
      hasImage: Boolean(image),
      hasLastFrame: Boolean(lastFrame),
    },
    'starting veo 3.1 video generation',
  );

  const operation = await client.models.generateVideos({
    model: 'veo-3.1-generate-001',
    prompt: input.prompt,
    ...(image ? { image } : {}),
    config: {
      aspectRatio,
      durationSeconds,
      ...(resolution ? { resolution } : {}),
      ...(lastFrame ? { lastFrame } : {}),
    },
  });
  throwIfCancelled(signal);

  let result = operation;
  const startedAt = Date.now();
  while (!result.done) {
    if (Date.now() - startedAt > VEO_MAX_POLL_MS) {
      throw new Error(
        `veo 3.1 polling timed out after ${Math.round(VEO_MAX_POLL_MS / 60_000)} minutes`,
      );
    }
    logger.info('waiting for veo 3.1 video generation...');
    await sleep(VEO_POLL_INTERVAL_MS, signal);
    result = await client.operations.get({ operation: result });
    throwIfCancelled(signal);
  }

  if (result.error) {
    throw new Error(`veo 3.1 failed: ${JSON.stringify(result.error)}`);
  }

  const generationResult = result as VideoGenerationResult;
  const videos =
    generationResult.response?.generatedVideos ?? generationResult.result?.generatedVideos;
  if (!videos || videos.length === 0) {
    throw new Error('veo 3.1 returned no videos');
  }

  const video = videos[0]?.video;
  const videoUri = video?.uri ?? video?.gcsUri;
  if (videoUri) {
    const videoUrl = videoUri.replace('gs://', 'https://storage.googleapis.com/');
    logger.info({ videoUrl }, 'veo 3.1 video generated');
    return { type: 'video', value: videoUrl };
  }

  const videoBytes = video?.videoBytes ?? video?.bytesBase64Encoded;
  if (videoBytes) {
    const mimeType = video?.mimeType ?? 'video/mp4';
    logger.info({ mimeType, bytes: videoBytes.length }, 'veo 3.1 inline video generated');
    return { type: 'video', value: `data:${mimeType};base64,${videoBytes}` };
  }

  throw new Error('veo 3.1 video has no URI or inline bytes');
}

function readStringSetting(settings: Record<string, unknown>, key: string): string | null {
  const value = settings[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readAspectRatio(settings: Record<string, unknown>): string {
  const value =
    readStringSetting(settings, 'aspect_ratio') ?? readStringSetting(settings, 'aspectRatio');
  return value && VEO_ASPECT_RATIOS.has(value) ? value : '16:9';
}

function readNumberSetting(settings: Record<string, unknown>, key: string): number | null {
  const value = settings[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function firstImage(primary: string | null, images: string[]): string | null {
  return primary?.trim() || images.find((value) => value.trim())?.trim() || null;
}

function nextImage(primary: string | null, images: string[], first: string | null): string | null {
  const explicit = primary?.trim();
  if (explicit && explicit !== first) return explicit;
  return images.find((value) => value.trim() && value.trim() !== first)?.trim() || null;
}

async function toVeoImage(value: string | null, signal?: AbortSignal): Promise<VeoImage | null> {
  if (!value?.trim()) return null;
  throwIfCancelled(signal);
  const source = value.trim();

  if (source.startsWith('gs://')) {
    return { gcsUri: source };
  }

  const dataUrl = parseImageDataUrl(source);
  if (dataUrl) return dataUrl;

  if (isHttpUrl(source)) {
    const response = await fetch(source, { signal });
    if (!response.ok) {
      throw new Error(`failed to fetch veo input image: HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') ?? '';
    const mimeType = contentType.split(';')[0]?.trim() || guessImageMimeType(source);
    if (!mimeType.startsWith('image/')) {
      throw new Error(`veo input URL is not an image: ${mimeType || 'unknown content-type'}`);
    }

    const bytes = Buffer.from(await response.arrayBuffer());
    throwIfCancelled(signal);
    return { imageBytes: bytes.toString('base64'), mimeType };
  }

  throw new Error('unsupported veo input image format');
}

function parseImageDataUrl(value: string): VeoImage | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(value);
  if (!match) return null;
  const mimeType = match[1];
  const imageBytes = match[2];
  if (!mimeType || !imageBytes) return null;
  return { mimeType, imageBytes: imageBytes.replace(/\s/g, '') };
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function guessImageMimeType(value: string): string {
  const pathname = new URL(value).pathname.toLowerCase();
  if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
  if (pathname.endsWith('.webp')) return 'image/webp';
  if (pathname.endsWith('.gif')) return 'image/gif';
  return 'image/png';
}
