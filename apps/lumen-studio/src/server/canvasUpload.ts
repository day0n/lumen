import 'server-only';

export type CanvasUploadKind = 'image' | 'video' | 'audio';

export const UPLOAD_AUTH_CLOCK_SKEW_MS = 5 * 60_000;

export const uploadConfigs: Record<
  CanvasUploadKind,
  {
    maxBytes: number;
    extensions: Record<string, string>;
    fallbackContentTypes: Record<string, string>;
  }
> = {
  image: {
    maxBytes: 12 * 1024 * 1024,
    extensions: {
      'image/png': 'png',
      'image/jpeg': 'jpg',
      'image/webp': 'webp',
      'image/gif': 'gif',
      'image/avif': 'avif',
    },
    fallbackContentTypes: {
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      webp: 'image/webp',
      gif: 'image/gif',
      avif: 'image/avif',
    },
  },
  video: {
    maxBytes: 120 * 1024 * 1024,
    extensions: {
      'video/mp4': 'mp4',
      'video/webm': 'webm',
      'video/quicktime': 'mov',
      'video/x-m4v': 'm4v',
    },
    fallbackContentTypes: {
      mp4: 'video/mp4',
      m4v: 'video/x-m4v',
      mov: 'video/quicktime',
      webm: 'video/webm',
    },
  },
  audio: {
    maxBytes: 50 * 1024 * 1024,
    extensions: {
      'audio/mpeg': 'mp3',
      'audio/mp3': 'mp3',
      'audio/wav': 'wav',
      'audio/x-wav': 'wav',
      'audio/ogg': 'ogg',
      'audio/aac': 'aac',
      'audio/mp4': 'm4a',
      'audio/x-m4a': 'm4a',
      'audio/flac': 'flac',
    },
    fallbackContentTypes: {
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      ogg: 'audio/ogg',
      aac: 'audio/aac',
      m4a: 'audio/mp4',
      flac: 'audio/flac',
    },
  },
};

export const mediaKindLabels: Record<CanvasUploadKind, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
};

export function readUploadKind(value: unknown): CanvasUploadKind {
  if (value === 'video' || value === 'audio' || value === 'image') return value;
  return 'image';
}

export function normalizeContentType(value: string): string {
  return value.split(';')[0]?.trim().toLowerCase() ?? '';
}

export function isSupportedMediaType(kind: CanvasUploadKind, contentType: string): boolean {
  return contentType in uploadConfigs[kind].extensions;
}

export function resolveMediaExtension(
  kind: CanvasUploadKind,
  rawContentType: string,
  fileName: string,
): string | null {
  const contentType = normalizeContentType(rawContentType);
  const fromType = uploadConfigs[kind].extensions[contentType];
  if (fromType) return fromType;

  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  const extension = match?.[1]?.toLowerCase();
  if (!extension) return null;
  if (extension in uploadConfigs[kind].fallbackContentTypes) return extension;
  return null;
}

export function fallbackContentType(kind: CanvasUploadKind, extension: string | null): string {
  if (!extension) return '';
  return uploadConfigs[kind].fallbackContentTypes[extension] ?? '';
}

export function toPathSegment(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || null;
}
