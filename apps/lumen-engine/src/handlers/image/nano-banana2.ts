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

  // Reference images (image-to-image). The resolver fills input.image /
  // input.lastFrameImage from upstream image nodes or settings.inputImage,
  // but historically this handler ignored them and only did text-to-image.
  // Feed every available reference as an inline part so the model can edit
  // from them — required for product-swap and character consistency.
  const referenceParts: ImagePart[] = [];
  for (const ref of [input.image, input.lastFrameImage]) {
    const part = await toImagePart(ref);
    if (part) referenceParts.push(part);
  }

  const response = await client.models.generateContent({
    model: 'gemini-3-pro-image-preview',
    contents: [{ role: 'user', parts: [...referenceParts, { text: input.prompt }] }],
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

async function toImagePart(value: string | null): Promise<ImagePart | null> {
  if (!value?.trim()) return null;
  const source = value.trim();

  if (source.startsWith('gs://')) {
    return { fileData: { fileUri: source, mimeType: guessImageMimeType(source) } };
  }

  const inline = parseImageDataUrl(source);
  if (inline) return { inlineData: inline };

  if (isHttpUrl(source)) {
    const response = await fetch(source);
    if (!response.ok) {
      throw new Error(`failed to fetch image reference: HTTP ${response.status}`);
    }
    const contentType = response.headers.get('content-type') ?? '';
    const mimeType = contentType.split(';')[0]?.trim() || guessImageMimeType(source);
    if (!mimeType.startsWith('image/')) {
      throw new Error(`image reference URL is not an image: ${mimeType || 'unknown content-type'}`);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    return { inlineData: { data: bytes.toString('base64'), mimeType } };
  }

  throw new Error('unsupported image reference format');
}

function parseImageDataUrl(value: string): { data: string; mimeType: string } | null {
  const match = /^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/s.exec(value);
  if (!match) return null;
  const mimeType = match[1];
  const data = match[2];
  if (!mimeType || !data) return null;
  return { mimeType, data: data.replace(/\s/g, '') };
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function guessImageMimeType(value: string): string {
  try {
    const pathname = new URL(value).pathname.toLowerCase();
    if (pathname.endsWith('.jpg') || pathname.endsWith('.jpeg')) return 'image/jpeg';
    if (pathname.endsWith('.webp')) return 'image/webp';
    if (pathname.endsWith('.gif')) return 'image/gif';
  } catch {
    // fall through
  }
  return 'image/png';
}
