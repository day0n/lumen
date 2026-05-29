import { getGoogleClient } from '../../clients/google.js';
import type { ResolvedInput } from '../../engine/resolver.js';
import { logger } from '../../utils/logger.js';
import type { NodeOutput } from '../base.js';

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

export async function execute(
  input: ResolvedInput,
  settings: Record<string, unknown>,
): Promise<NodeOutput> {
  const client = getGoogleClient();

  const aspectRatio =
    readStringSetting(settings, 'aspect_ratio') ??
    readStringSetting(settings, 'aspectRatio') ??
    '16:9';
  const durationSeconds = readNumberSetting(settings, 'duration') ?? 8;

  const operation = await client.models.generateVideos({
    model: 'veo-3.1-generate-001',
    prompt: input.prompt,
    config: {
      aspectRatio,
      durationSeconds,
    },
  });

  let result = operation;
  while (!result.done) {
    logger.info('waiting for veo 3.1 video generation...');
    await sleep(10_000);
    result = await client.operations.get({ operation: result });
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readStringSetting(settings: Record<string, unknown>, key: string): string | null {
  const value = settings[key];
  return typeof value === 'string' && value.trim() ? value : null;
}

function readNumberSetting(settings: Record<string, unknown>, key: string): number | null {
  const value = settings[key];
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}
