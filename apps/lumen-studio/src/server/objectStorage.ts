import 'server-only';

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
  const arrayBuffer = await response.arrayBuffer();
  const bytes = arrayBuffer.byteLength;
  const maxBytes = args.maxBytes ?? 200 * 1024 * 1024;
  if (bytes > maxBytes) {
    throw new Error(
      `源文件过大（${(bytes / 1024 / 1024).toFixed(1)}MB > ${maxBytes / 1024 / 1024}MB）`,
    );
  }
  if (bytes < 1024) {
    throw new Error(`源文件太小（${bytes}B），可能不是有效内容`);
  }

  const contentType =
    response.headers.get('content-type')?.split(';')[0]?.trim() || args.fallbackContentType;

  return uploadBuffer({
    body: Buffer.from(arrayBuffer),
    contentType,
    prefix: args.prefix,
    extension: args.extension,
  });
}
