import { getGoogleClient } from '../../clients/google.js';
import type { ResolvedInput } from '../../engine/resolver.js';
import { logger } from '../../utils/logger.js';
import type { NodeOutput } from '../base.js';

interface GeneratedVideo {
  video?: {
    uri?: string;
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

  const aspectRatio = (settings.aspect_ratio as string) ?? '16:9';
  const durationSeconds = (settings.duration as number) ?? 8;

  const operation = await client.models.generateVideos({
    model: 'veo-3.1-generate-preview',
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

  const videoUri = videos[0]?.video?.uri;
  if (!videoUri) {
    throw new Error('veo 3.1 video has no URI');
  }

  // GCS URI → public HTTPS URL
  const videoUrl = videoUri.replace('gs://', 'https://storage.googleapis.com/');
  logger.info({ videoUrl }, 'veo 3.1 video generated');

  return { type: 'video', value: videoUrl };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
