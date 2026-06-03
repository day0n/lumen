import { translate } from '@/i18n/messages';
import { requireStudioUser } from '@/server/auth';
import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { uploadBuffer } from '@/server/objectStorage';

export const runtime = 'nodejs';

const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

export const POST = withApiRouteSpan('POST /api/canvas/uploads', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const user = await requireStudioUser();
    const form = await request.formData();
    const file = form.get('file');

    if (!(file instanceof File)) {
      return failJson(translate(locale, 'api.uploadMissingImage'), 400);
    }

    const contentType = normalizeContentType(file.type);
    if (!contentType || !contentType.startsWith('image/')) {
      return failJson(translate(locale, 'api.uploadImageOnly'), 400);
    }
    if (file.size <= 0) {
      return failJson(translate(locale, 'api.uploadEmptyImage'), 400);
    }
    if (file.size > MAX_IMAGE_BYTES) {
      return failJson(translate(locale, 'api.uploadImageTooLarge'), 400);
    }

    const extension = resolveImageExtension(contentType, file.name);
    if (!extension) {
      return failJson(translate(locale, 'api.uploadUnsupportedImage'), 400);
    }

    const workflowId = toPathSegment(form.get('workflowId'));
    const nodeId = toPathSegment(form.get('nodeId'));
    const bytes = Buffer.from(await file.arrayBuffer());
    const result = await uploadBuffer({
      body: bytes,
      contentType,
      extension,
      prefix: ['canvas', user.id, workflowId, nodeId].filter(Boolean).join('/'),
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

function normalizeContentType(value: string): string {
  return value.split(';')[0]?.trim().toLowerCase() ?? '';
}

function resolveImageExtension(contentType: string, fileName: string): string | null {
  const fromType = IMAGE_EXTENSIONS[contentType];
  if (fromType) return fromType;

  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  const extension = match?.[1]?.toLowerCase();
  if (!extension) return null;
  if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'avif'].includes(extension)) {
    return extension === 'jpeg' ? 'jpg' : extension;
  }
  return null;
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
