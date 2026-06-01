import { randomUUID } from 'node:crypto';

import { translate } from '@/i18n/messages';
import { requireStudioUser } from '@/server/auth';
import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { createStudioMaterialAssetForOwner, listStudioMaterialAssets } from '@/server/materials';
import { uploadBuffer } from '@/server/objectStorage';
import {
  MaterialAssetCategorySchema,
  MaterialAssetKindSchema,
  UserUploadMaterialAssetCategorySchema,
} from '@lumen/db';

export const runtime = 'nodejs';

const MAX_BATCH_IMAGES = 9;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

const IMAGE_EXTENSIONS: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/avif': 'avif',
};

export const GET = withApiRouteSpan('GET /api/material-assets', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const url = new URL(request.url);
    const workflowId = url.searchParams.get('workflowId') ?? undefined;
    const categoryParam = url.searchParams.get('category') ?? undefined;
    const kindParam = url.searchParams.get('kind') ?? undefined;
    const limitParam = url.searchParams.get('limit');
    const category = categoryParam ? MaterialAssetCategorySchema.parse(categoryParam) : undefined;
    const kind = kindParam ? MaterialAssetKindSchema.parse(kindParam) : undefined;
    const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
    const assets = await listStudioMaterialAssets({ workflowId, category, kind, limit });

    return okJson({ assets });
  } catch (error) {
    return routeError(error, locale);
  }
});

export const POST = withApiRouteSpan('POST /api/material-assets', async (request: Request) => {
  const locale = resolveRequestLocale(request);
  try {
    const user = await requireStudioUser();
    const form = await request.formData();
    const title = toFormText(form.get('title'))?.slice(0, 160);
    const subcategory = toFormText(form.get('subcategory'))?.slice(0, 80);
    const sellingPoints = form
      .getAll('sellingPoints')
      .map(toFormText)
      .filter((value): value is string => Boolean(value))
      .map((value) => value.slice(0, 120))
      .slice(0, 3);
    const category = UserUploadMaterialAssetCategorySchema.parse(toFormText(form.get('category')));
    const files = form
      .getAll('files')
      .concat(form.getAll('file'))
      .filter((value): value is File => value instanceof File);

    if (!title) {
      return failJson(translate(locale, 'api.materialTitleRequired'), 400);
    }
    if (files.length === 0) {
      return failJson(translate(locale, 'api.uploadMissingImage'), 400);
    }
    if (files.length > MAX_BATCH_IMAGES) {
      return failJson(
        translate(locale, 'api.materialUploadTooMany', { count: MAX_BATCH_IMAGES }),
        400,
      );
    }

    const batchId = randomUUID();
    const assets = [];

    for (const [index, file] of files.entries()) {
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

      const bytes = Buffer.from(await file.arrayBuffer());
      const upload = await uploadBuffer({
        body: bytes,
        contentType,
        extension,
        prefix: ['materials', user.id, category].join('/'),
      });

      const asset = await createStudioMaterialAssetForOwner(user.id, {
        category,
        kind: 'image',
        title: titleForFile(title, files.length, index),
        url: upload.url,
        thumbnailUrl: upload.url,
        r2Key: upload.key,
        contentType,
        size: upload.size,
        metadata: {
          ...(subcategory ? { subcategory } : {}),
          ...(sellingPoints.length ? { sellingPoints } : {}),
          ...(file.name ? { originalName: file.name } : {}),
          batchId,
          position: index,
        },
      });
      assets.push(asset);
    }

    return okJson({ assets });
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

function toFormText(value: FormDataEntryValue | null): string | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim();
  return normalized.length > 0 ? normalized : undefined;
}

function titleForFile(title: string, total: number, index: number): string {
  if (total <= 1) return title;
  return `${title} ${index + 1}`;
}
