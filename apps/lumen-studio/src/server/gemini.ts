import 'server-only';

import { GoogleGenAI } from '@google/genai';

import { getStudioServerConfig } from './config';

let cachedClient: GoogleGenAI | null = null;

export class GeminiNotConfiguredError extends Error {
  constructor() {
    super('Gemini 未配置（需要 GOOGLE_OC_JSON/GOOGLE_CLOUD_PROJECT/GOOGLE_CLOUD_LOCATION）');
    this.name = 'GeminiNotConfiguredError';
  }
}

export function getStudioGoogleClient(): GoogleGenAI {
  if (cachedClient) return cachedClient;

  const config = getStudioServerConfig();
  const serviceAccount = config.GOOGLE_OC_JSON?.trim();
  const project = config.GOOGLE_CLOUD_PROJECT?.trim();
  const location = config.GOOGLE_CLOUD_LOCATION?.trim() || 'global';

  if (!serviceAccount || !project) {
    throw new GeminiNotConfiguredError();
  }

  const serviceAccountJson = Buffer.from(serviceAccount, 'base64').toString('utf-8');
  const credentials = JSON.parse(serviceAccountJson);

  cachedClient = new GoogleGenAI({
    vertexai: true,
    project,
    location,
    googleAuthOptions: { credentials },
  });

  return cachedClient;
}

export async function generateGeminiText(prompt: string): Promise<string> {
  const client = getStudioGoogleClient();
  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
  });

  return response.text ?? '';
}

interface MultimodalInput {
  prompt: string;
  /** Public URL of media to download and pass as inline_data. */
  mediaUrl?: string;
  /** Override MIME if URL doesn't carry a useful Content-Type. */
  mediaMimeType?: string;
  /** Raw bytes when caller already has them (skips download). */
  mediaBytes?: Buffer;
  /** Hard cap on inline payload size (defaults to 18MB, well under 20MB API limit). */
  maxInlineBytes?: number;
  /** Output token budget. Defaults to 8192, plenty for structured JSON breakdowns. */
  maxOutputTokens?: number;
  temperature?: number;
}

const DEFAULT_INLINE_LIMIT = 18 * 1024 * 1024;

/**
 * Multimodal Gemini text generation: pass a single media file (video/image/audio) + prompt,
 * get back text. Used by the viral-remake breakdown to feed the actual reference video to
 * the model instead of relying on title/hook metadata.
 *
 * Inline-only for now; if the file is bigger than `maxInlineBytes`, throws so the caller
 * can pick a downsampling strategy.
 */
export async function generateGeminiMultimodalText(input: MultimodalInput): Promise<string> {
  const client = getStudioGoogleClient();
  const parts: Array<Record<string, unknown>> = [];

  const bytes = await resolveMediaBytes(input);
  if (bytes) {
    parts.push({
      inlineData: {
        data: bytes.buffer.toString('base64'),
        mimeType: bytes.mimeType,
      },
    });
  }
  parts.push({ text: input.prompt });

  const response = await client.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: [{ role: 'user', parts }],
    config: {
      temperature: input.temperature ?? 0.2,
      maxOutputTokens: input.maxOutputTokens ?? 8192,
    },
  });

  return response.text ?? '';
}

async function resolveMediaBytes(
  input: MultimodalInput,
): Promise<{ buffer: Buffer; mimeType: string } | null> {
  const limit = input.maxInlineBytes ?? DEFAULT_INLINE_LIMIT;
  if (input.mediaBytes) {
    if (input.mediaBytes.byteLength > limit) {
      throw new Error(
        `Media payload too large for inline data (${input.mediaBytes.byteLength} > ${limit})`,
      );
    }
    return {
      buffer: input.mediaBytes,
      mimeType: input.mediaMimeType ?? 'application/octet-stream',
    };
  }
  if (!input.mediaUrl) return null;

  const response = await fetch(input.mediaUrl, {
    signal: AbortSignal.timeout(60_000),
    redirect: 'follow',
  });
  if (!response.ok) {
    throw new Error(`Failed to download media (${response.status}) for Gemini multimodal call`);
  }
  const arrayBuffer = await response.arrayBuffer();
  if (arrayBuffer.byteLength > limit) {
    throw new Error(
      `Media payload too large for inline data (${arrayBuffer.byteLength} > ${limit})`,
    );
  }
  const mimeType =
    input.mediaMimeType ??
    response.headers.get('content-type')?.split(';')[0]?.trim() ??
    inferMimeFromUrl(input.mediaUrl) ??
    'application/octet-stream';
  return { buffer: Buffer.from(arrayBuffer), mimeType };
}

function inferMimeFromUrl(url: string): string | null {
  const path = url.split(/[?#]/)[0] ?? '';
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  switch (ext) {
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'png':
      return 'image/png';
    default:
      return null;
  }
}
