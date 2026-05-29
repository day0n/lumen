import { getGoogleClient } from '../../clients/google.js';
import type { ResolvedInput } from '../../engine/resolver.js';
import { logger } from '../../utils/logger.js';
import type { NodeOutput } from '../base.js';

interface ImagePart {
  inlineData?: {
    data?: string;
    mimeType?: string;
  };
}

export async function execute(
  input: ResolvedInput,
  settings: Record<string, unknown>,
): Promise<NodeOutput> {
  const client = getGoogleClient();

  const aspectRatio = (settings.aspect_ratio as string) ?? '16:9';

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

  const imagePart = (candidate.content.parts as ImagePart[]).find((p) => p.inlineData?.data);
  if (!imagePart?.inlineData) {
    throw new Error('no inline image data in response');
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
