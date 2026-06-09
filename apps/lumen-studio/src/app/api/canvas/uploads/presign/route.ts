import { z } from 'zod';

import { translate } from '@/i18n/messages';
import { requireStudioUser } from '@/server/auth';
import {
  UPLOAD_AUTH_CLOCK_SKEW_MS,
  fallbackContentType,
  isSupportedMediaType,
  mediaKindLabels,
  readUploadKind,
  resolveMediaExtension,
  toPathSegment,
  uploadConfigs,
} from '@/server/canvasUpload';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { createPresignedUpload } from '@/server/objectStorage';

export const runtime = 'nodejs';

const PresignUploadSchema = z.object({
  contentType: z.string().max(200).default(''),
  filename: z.string().max(255).default('upload'),
  kind: z.enum(['image', 'video', 'audio']).default('image'),
  nodeId: z.string().optional().nullable(),
  size: z.number().int().positive(),
  workflowId: z.string().optional().nullable(),
});

export const POST = withApiRouteSpan(
  'POST /api/canvas/uploads/presign',
  async (request: Request) => {
    const locale = resolveRequestLocale(request);
    try {
      const user = await requireStudioUser(request, {
        sessionClockSkewInMs: UPLOAD_AUTH_CLOCK_SKEW_MS,
      });
      const body = PresignUploadSchema.parse(await readJson(request));
      const kind = readUploadKind(body.kind);
      const config = uploadConfigs[kind];

      if (body.size > config.maxBytes) {
        return failJson(
          translate(locale, 'api.uploadMediaTooLarge', {
            size: Math.round(config.maxBytes / 1024 / 1024),
          }),
          400,
        );
      }

      const extension = resolveMediaExtension(kind, body.contentType, body.filename);
      const contentType =
        body.contentType.split(';')[0]?.trim().toLowerCase() ||
        fallbackContentType(kind, extension);
      if (!extension || !isSupportedMediaType(kind, contentType)) {
        return failJson(
          translate(locale, 'api.uploadMediaOnly', { kind: mediaKindLabels[kind] }),
          400,
        );
      }

      const workflowId = toPathSegment(body.workflowId);
      const nodeId = toPathSegment(body.nodeId);
      const result = await createPresignedUpload({
        contentType,
        extension,
        prefix: ['canvas', user.id, kind, workflowId, nodeId].filter(Boolean).join('/'),
      });

      return okJson({
        asset: {
          key: result.key,
          url: result.url,
          name: body.filename || `upload.${extension}`,
          contentType,
          size: body.size,
        },
        upload: {
          url: result.uploadUrl,
          headers: result.headers,
          expiresAt: result.expiresAt,
          expiresIn: result.expiresIn,
        },
      });
    } catch (error) {
      return routeError(error, locale);
    }
  },
);
