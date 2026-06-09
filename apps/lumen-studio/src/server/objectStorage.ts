import 'server-only';

import { Readable } from 'node:stream';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { customAlphabet } from 'nanoid';

import { getStudioServerConfig } from './config';

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 18);
const OBJECT_CACHE_CONTROL = 'public, max-age=31536000, immutable';

let cachedClient: S3Client | null = null;

export interface R2Settings {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
}

export class ObjectStorageNotConfiguredError extends Error {
  constructor() {
    super(
      'R2 object storage 未配置（需要 R2_ACCOUNT_ID/R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_PUBLIC_BASE_URL）',
    );
    this.name = 'ObjectStorageNotConfiguredError';
  }
}

export function getR2Settings(): R2Settings | null {
  const config = getStudioServerConfig();
  const accountId = config.R2_ACCOUNT_ID?.trim();
  const bucket = config.R2_BUCKET?.trim();
  const accessKeyId = config.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = config.R2_SECRET_ACCESS_KEY?.trim();
  const publicBaseUrl = config.R2_PUBLIC_BASE_URL?.trim();

  if (!accountId || !bucket || !accessKeyId || !secretAccessKey || !publicBaseUrl) {
    return null;
  }
  return { accountId, bucket, accessKeyId, secretAccessKey, publicBaseUrl };
}

export function isObjectStorageConfigured(): boolean {
  return getR2Settings() !== null;
}

function getClient(settings: R2Settings): S3Client {
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: 'auto',
    endpoint: `https://${settings.accountId}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: settings.accessKeyId,
      secretAccessKey: settings.secretAccessKey,
    },
  });
  return cachedClient;
}

export interface UploadResult {
  key: string;
  url: string;
  size: number;
}

function buildObjectKey(prefix: string | undefined, extension: string): string {
  const folder = prefix?.trim().replace(/^\/+|\/+$/g, '') ?? 'lumen';
  return `${folder}/${nano()}.${extension.replace(/^\./, '')}`;
}

function publicUrlForKey(settings: R2Settings, key: string): string {
  const base = settings.publicBaseUrl.replace(/\/+$/, '');
  return `${base}/${key}`;
}

export async function uploadBuffer(args: {
  body: Buffer | Uint8Array;
  contentType: string;
  prefix?: string;
  extension: string;
}): Promise<UploadResult> {
  const settings = getR2Settings();
  if (!settings) throw new ObjectStorageNotConfiguredError();

  const client = getClient(settings);
  const key = buildObjectKey(args.prefix, args.extension);

  await client.send(
    new PutObjectCommand({
      Bucket: settings.bucket,
      Key: key,
      Body: args.body,
      ContentType: args.contentType,
      CacheControl: OBJECT_CACHE_CONTROL,
    }),
  );

  return {
    key,
    url: publicUrlForKey(settings, key),
    size: args.body.byteLength,
  };
}

/**
 * 流式上传：把 Node Readable 直接 PUT 到 R2，不在内存里材料化整段内容。
 * `contentLength` 必须给——AWS SDK v3 不知道大小时会回退到 buffer-and-hash。
 *
 * 用于 raw upload 与 uploadFromUrl 这种我们能拿到长度但不该把整段视频拉进
 * heap 的场景。原来的 `Buffer.from(await arrayBuffer())` 会让一个 120MB 视频
 * 在 heap 里同时占 ~3 份（arrayBuffer + Buffer 拷贝 + SDK 内部分片），高并发
 * 上传直接顶满 PM2 的 1-2GB 限制。
 */
export async function uploadStream(args: {
  body: Readable;
  contentLength: number;
  contentType: string;
  prefix?: string;
  extension: string;
}): Promise<UploadResult> {
  const settings = getR2Settings();
  if (!settings) throw new ObjectStorageNotConfiguredError();

  const client = getClient(settings);
  const key = buildObjectKey(args.prefix, args.extension);

  await client.send(
    new PutObjectCommand({
      Bucket: settings.bucket,
      Key: key,
      Body: args.body,
      ContentLength: args.contentLength,
      ContentType: args.contentType,
      CacheControl: OBJECT_CACHE_CONTROL,
    }),
  );

  return {
    key,
    url: publicUrlForKey(settings, key),
    size: args.contentLength,
  };
}

export async function createPresignedUpload(args: {
  contentType: string;
  prefix?: string;
  extension: string;
  expiresInSeconds?: number;
}): Promise<{
  expiresAt: string;
  expiresIn: number;
  headers: Record<string, string>;
  key: string;
  uploadUrl: string;
  url: string;
}> {
  const settings = getR2Settings();
  if (!settings) throw new ObjectStorageNotConfiguredError();

  const client = getClient(settings);
  const key = buildObjectKey(args.prefix, args.extension);
  const expiresIn = args.expiresInSeconds ?? 15 * 60;
  const headers = {
    'Content-Type': args.contentType,
    'Cache-Control': OBJECT_CACHE_CONTROL,
  };
  const command = new PutObjectCommand({
    Bucket: settings.bucket,
    Key: key,
    ContentType: args.contentType,
    CacheControl: OBJECT_CACHE_CONTROL,
  });
  const uploadUrl = await getSignedUrl(client as never, command as never, { expiresIn });

  return {
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    expiresIn,
    headers,
    key,
    uploadUrl,
    url: publicUrlForKey(settings, key),
  };
}

export async function uploadFromUrl(args: {
  sourceUrl: string;
  prefix?: string;
  extension: string;
  fallbackContentType: string;
  /** Hard limit on bytes downloaded; reject if exceeded. */
  maxBytes?: number;
}): Promise<UploadResult> {
  const response = await fetch(args.sourceUrl, {
    redirect: 'follow',
    headers: {
      // TikTok CDN blocks bare requests; mimic a real browser.
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      accept: '*/*',
      referer: 'https://www.tiktok.com/',
    },
    signal: AbortSignal.timeout(180_000),
  });
  if (!response.ok) {
    throw new Error(`下载源文件失败: ${response.status} ${response.statusText}`);
  }

  const maxBytes = args.maxBytes ?? 200 * 1024 * 1024;
  const declared = Number(response.headers.get('content-length') ?? '');
  const contentType =
    response.headers.get('content-type')?.split(';')[0]?.trim() || args.fallbackContentType;

  // Fast path: upstream advertises a length we trust → stream straight to R2
  // with a length-bounded transform so we never hold the whole video in heap.
  if (Number.isFinite(declared) && declared > 0 && declared <= maxBytes) {
    if (declared < 1024) {
      // small files: read into memory so we keep the existing "too small"
      // sanity check exact, since some upstreams send incorrect Content-Length
      const buf = Buffer.from(await response.arrayBuffer());
      if (buf.byteLength < 1024) {
        throw new Error(`源文件太小（${buf.byteLength}B），可能不是有效内容`);
      }
      return uploadBuffer({
        body: buf,
        contentType,
        prefix: args.prefix,
        extension: args.extension,
      });
    }
    if (!response.body) {
      throw new Error('上游响应无 body 流');
    }
    return uploadStream({
      body: Readable.fromWeb(response.body as never),
      contentLength: declared,
      contentType,
      prefix: args.prefix,
      extension: args.extension,
    });
  }

  // Fallback path: no Content-Length (chunked encoding) or server-claimed
  // length is over the cap. Stream into memory but bail as soon as we cross
  // maxBytes so a misbehaving server cannot OOM the process.
  if (!response.body) {
    throw new Error('上游响应无 body 流');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    if (value) {
      received += value.byteLength;
      if (received > maxBytes) {
        await reader.cancel();
        throw new Error(
          `源文件过大（>${(received / 1024 / 1024).toFixed(1)}MB > ${maxBytes / 1024 / 1024}MB）`,
        );
      }
      chunks.push(value);
    }
  }
  if (received < 1024) {
    throw new Error(`源文件太小（${received}B），可能不是有效内容`);
  }

  return uploadBuffer({
    body: Buffer.concat(chunks),
    contentType,
    prefix: args.prefix,
    extension: args.extension,
  });
}
