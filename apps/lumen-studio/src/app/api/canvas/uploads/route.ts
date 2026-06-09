import { translate } from '@/i18n/messages';
import { requireStudioUser } from '@/server/auth';
import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { uploadBuffer } from '@/server/objectStorage';

export const runtime = 'nodejs';

type CanvasUploadKind = 'image' | 'video' | 'audio';

const UPLOAD_AUTH_CLOCK_SKEW_MS = 5 * 60_000;

const uploadConfigs: Record<
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

const mediaKindLabels: Record<CanvasUploadKind, string> = {
  image: 'image',
  video: 'video',
  audio: 'audio',
};

export const POST = withApiRouteSpan('POST /api/canvas/uploads', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const user = await requireStudioUser(request, {
      sessionClockSkewInMs: UPLOAD_AUTH_CLOCK_SKEW_MS,
    });
    const form = await request.formData();
    const file = form.get('file');
    const kind = readUploadKind(form.get('kind'));
    const config = uploadConfigs[kind];

    if (!(file instanceof File)) {
      return failJson(translate(locale, 'api.uploadMissingMedia'), 400);
    }

    const extension = resolveMediaExtension(kind, file.type, file.name);
    const contentType = normalizeContentType(file.type) || fallbackContentType(kind, extension);
    if (!extension || !isSupportedMediaType(kind, contentType)) {
      return failJson(
        translate(locale, 'api.uploadMediaOnly', { kind: mediaKindLabels[kind] }),
        400,
      );
    }
    if (file.size <= 0) {
      return failJson(translate(locale, 'api.uploadEmptyMedia'), 400);
    }
    if (file.size > config.maxBytes) {
      return failJson(
        translate(locale, 'api.uploadMediaTooLarge', {
          size: Math.round(config.maxBytes / 1024 / 1024),
        }),
        400,
      );
    }

    const workflowId = toPathSegment(form.get('workflowId'));
    const nodeId = toPathSegment(form.get('nodeId'));
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await uploadBuffer({
      body: bytes,
      contentType,
      extension,
      prefix: ['canvas', user.id, kind, workflowId, nodeId].filter(Boolean).join('/'),
    });

    return okJson({
      asset: {
        key: result.key,
        url: result.url,
        name: file.name || `image.${extension}`,
        contentType,
        size: result.size,
      },
    });
  } catch (error) {
    return routeError(error, locale);
  }
});

function readUploadKind(value: FormDataEntryValue | null): CanvasUploadKind {
  if (value === 'video' || value === 'audio' || value === 'image') return value;
  return 'image';
}

function normalizeContentType(value: string): string {
  return value.split(';')[0]?.trim().toLowerCase() ?? '';
}

function isSupportedMediaType(kind: CanvasUploadKind, contentType: string): boolean {
  return contentType in uploadConfigs[kind].extensions;
}

function resolveMediaExtension(
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

function fallbackContentType(kind: CanvasUploadKind, extension: string | null): string {
  if (!extension) return '';
  return uploadConfigs[kind].fallbackContentTypes[extension] ?? '';
}

function toPathSegment(value: FormDataEntryValue | null): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
  return cleaned || null;
}
