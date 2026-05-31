import { getGoogleClient } from '../../clients/google.js';
import type { ResolvedInput } from '../../engine/resolver.js';
import { logger } from '../../utils/logger.js';
import type { NodeOutput } from '../base.js';

interface ImagePart {
  text?: string;
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
  fileData?: {
    fileUri?: string;
    gcsUri?: string;
    mimeType?: string;
    uri?: string;
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

  const response = await client.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
    config: {
      responseModalities: ['IMAGE'],
      imageConfig: { aspectRatio },
    },
  });

  const candidate = response.candidates?.[0];
  if (!candidate?.content?.parts) {
    throw new Error('no image generated from nano-banana2');
  }

  const parts = candidate.content.parts as ImagePart[];
  const imagePart = parts.find((p) => p.inlineData?.data);
  if (!imagePart?.inlineData) {
    const filePart = parts.find(
      (p) => p.fileData?.fileUri || p.fileData?.gcsUri || p.fileData?.uri,
    );
    const fileUri =
      filePart?.fileData?.fileUri ?? filePart?.fileData?.gcsUri ?? filePart?.fileData?.uri;
    if (fileUri) {
      const mediaUrl = normalizeGeneratedMediaUri(fileUri);
      logger.info({ mediaUrl }, 'nano-banana2 image generated as file uri');
      return { type: 'image', value: mediaUrl };
    }

    const text = parts
      .map((part) => part.text?.trim())
      .filter(Boolean)
      .join('\n')
      .slice(0, 500);
    throw new Error(text ? `no image data in response: ${text}` : 'no image data in response');
  }

  const base64 = imagePart.inlineData.data ?? '';
  if (!base64) {
    throw new Error('empty image data from nano-banana2');
  }
  const mimeType = imagePart.inlineData.mimeType ?? 'image/png';
  const dataUrl = `data:${mimeType};base64,${base64}`;

  logger.info({ mimeType, bytes: base64.length }, 'nano-banana2 image generated');

  return { type: 'image', value: dataUrl };
}

function normalizeGeneratedMediaUri(value: string): string {
  return value.startsWith('gs://')
    ? value.replace('gs://', 'https://storage.googleapis.com/')
    : value;
}

function readStringSetting(settings: Record<string, unknown>, key: string): string | null {
  const value = settings[key];
  return typeof value === 'string' && value.trim() ? value : null;
}
