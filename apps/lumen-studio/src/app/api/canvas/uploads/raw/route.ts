import { Readable } from 'node:stream';

import { translate } from '@/i18n/messages';
import { requireStudioUser } from '@/server/auth';
import {
  UPLOAD_AUTH_CLOCK_SKEW_MS,
  fallbackContentType,
  isSupportedMediaType,
  mediaKindLabels,
  normalizeContentType,
  readUploadKind,
  resolveMediaExtension,
  toPathSegment,
  uploadConfigs,
} from '@/server/canvasUpload';
import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { uploadStream } from '@/server/objectStorage';

export const runtime = 'nodejs';

function readUploadHeader(request: Request, name: string): string {
  return request.headers.get(name)?.trim() ?? '';
}

function decodeUploadHeader(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export const POST = withApiRouteSpan('POST /api/canvas/uploads/raw', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const user = await requireStudioUser(request, {
      sessionClockSkewInMs: UPLOAD_AUTH_CLOCK_SKEW_MS,
    });

    const kind = readUploadKind(readUploadHeader(request, 'x-lumen-upload-kind'));
    const config = uploadConfigs[kind];
    const fileName =
      decodeUploadHeader(readUploadHeader(request, 'x-lumen-upload-filename')) || 'upload';
    const rawContentType =
      normalizeContentType(readUploadHeader(request, 'x-lumen-upload-content-type')) ||
      normalizeContentType(request.headers.get('content-type') ?? '');
    const contentLength = Number(request.headers.get('content-length') ?? 0);

    if (!Number.isFinite(contentLength) || contentLength <= 0) {
      return failJson(translate(locale, 'api.uploadEmptyMedia'), 400);
    }
    if (contentLength > config.maxBytes) {
      return failJson(
        translate(locale, 'api.uploadMediaTooLarge', {
          size: Math.round(config.maxBytes / 1024 / 1024),
        }),
        400,
      );
    }

    const extension = resolveMediaExtension(kind, rawContentType, fileName);
    const contentType = rawContentType || fallbackContentType(kind, extension);
    if (!extension || !isSupportedMediaType(kind, contentType)) {
      return failJson(
        translate(locale, 'api.uploadMediaOnly', { kind: mediaKindLabels[kind] }),
        400,
      );
    }

    if (!request.body) {
      return failJson(translate(locale, 'api.uploadEmptyMedia'), 400);
    }

    const workflowId = toPathSegment(readUploadHeader(request, 'x-lumen-upload-workflow-id'));
    const nodeId = toPathSegment(readUploadHeader(request, 'x-lumen-upload-node-id'));

    // Stream the request body straight to R2 — never materialize the whole
    // upload into a Node Buffer. Content-Length was validated above so the
    // SDK can do a single PutObject without buffering for hash.
    const result = await uploadStream({
      body: Readable.fromWeb(request.body as never),
      contentLength,
      contentType,
      extension,
      prefix: ['canvas', user.id, kind, workflowId, nodeId].filter(Boolean).join('/'),
    });

    return okJson({
      asset: {
        key: result.key,
        url: result.url,
        name: fileName || `upload.${extension}`,
        contentType,
        size: result.size,
      },
    });
  } catch (error) {
    return routeError(error, locale);
  }
});
