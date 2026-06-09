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
import { uploadBuffer } from '@/server/objectStorage';

export const runtime = 'nodejs';

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
