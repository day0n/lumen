import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import type { NodeType } from '@lumen/shared/domain';
import * as Sentry from '@sentry/node';
import { customAlphabet } from 'nanoid';

import { config } from '../config.js';
import type { WorkflowOutputAsset } from '../database/workflow-store.js';
import type { NodeOutput } from '../handlers/base.js';
import { logger } from '../utils/logger.js';

const nano = customAlphabet('0123456789abcdefghijklmnopqrstuvwxyz', 18);
const MEDIA_TYPES = new Set<NodeType>(['image', 'video', 'audio']);

let cachedClient: S3Client | null = null;

interface R2Settings {
  accountId: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
}

export interface StoredNodeOutput {
  type: NodeType;
  value: string;
  asset?: WorkflowOutputAsset;
}

export class ObjectStorageNotConfiguredError extends Error {
  constructor() {
    super(
      'R2 object storage is required for workflow media results (R2_ACCOUNT_ID/R2_BUCKET/R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY/R2_PUBLIC_BASE_URL)',
    );
    this.name = 'ObjectStorageNotConfiguredError';
  }
}

export async function persistNodeOutput(args: {
  output: NodeOutput;
  runId: string;
  projectId?: string | null;
  nodeId: string;
}): Promise<StoredNodeOutput> {
  if (!MEDIA_TYPES.has(args.output.type)) {
    return { type: args.output.type, value: args.output.value };
  }

  const settings = getR2Settings();
  if (!settings) throw new ObjectStorageNotConfiguredError();

  const prefix = [
    'workflow-results',
    args.projectId?.trim() || 'unbound-project',
    args.runId,
    args.nodeId,
  ].join('/');

  const alreadyStored = readR2PublicUrl(args.output.value, settings);
  if (alreadyStored) {
    return {
      type: args.output.type,
      value: args.output.value,
      asset: {
        storage: 'r2',
        key: alreadyStored.key,
        url: args.output.value,
        content_type: fallbackContentType(args.output.type),
        size: 0,
        uploaded_at: new Date(),
      },
    };
  }

  if (args.output.value.startsWith('data:')) {
    const parsed = parseDataUrl(args.output.value);
    const maxBytes = maxBytesFor(args.output.type);
    if (parsed.body.byteLength > maxBytes) {
      throw new Error(
        `Generated ${args.output.type} is too large (${(
          parsed.body.byteLength / 1024 / 1024
        ).toFixed(1)}MB > ${(maxBytes / 1024 / 1024).toFixed(0)}MB)`,
      );
    }
    const extension = extensionFor(parsed.contentType, args.output.type);
    const upload = await uploadBuffer({
      body: parsed.body,
      contentType: parsed.contentType,
      extension,
      prefix,
      settings,
    });
    return {
      type: args.output.type,
      value: upload.url,
      asset: upload,
    };
  }

  if (isHttpUrl(args.output.value)) {
    const upload = await uploadFromUrl({
      sourceUrl: args.output.value,
      outputType: args.output.type,
      prefix,
      settings,
    });
    return {
      type: args.output.type,
      value: upload.url,
      asset: upload,
    };
  }

  throw new Error(
    `Unsupported media output format for ${args.output.type}: expected data URL or URL`,
  );
}

function getR2Settings(): R2Settings | null {
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

async function uploadBuffer(args: {
  body: Buffer;
  contentType: string;
  extension: string;
  prefix: string;
  settings: R2Settings;
  originalUrl?: string;
}): Promise<WorkflowOutputAsset> {
  const key = `${args.prefix.replace(/^\/+|\/+$/g, '')}/${nano()}.${args.extension.replace(
    /^\./,
    '',
  )}`;

  await Sentry.startSpan(
    {
      name: 'r2.upload',
      op: 'http.client',
      attributes: {
        'r2.key': key,
        content_type: args.contentType,
        bytes: args.body.byteLength,
      },
    },
    () =>
      getClient(args.settings).send(
        new PutObjectCommand({
          Bucket: args.settings.bucket,
          Key: key,
          Body: args.body,
          ContentType: args.contentType,
          CacheControl: 'public, max-age=31536000, immutable',
        }),
      ),
  );

  const base = args.settings.publicBaseUrl.replace(/\/+$/, '');
  const asset: WorkflowOutputAsset = {
    storage: 'r2',
    key,
    url: `${base}/${key}`,
    content_type: args.contentType,
    size: args.body.byteLength,
    uploaded_at: new Date(),
  };
  if (args.originalUrl) asset.original_url = args.originalUrl;

  logger.info(
    {
      key: asset.key,
      content_type: asset.content_type,
      bytes: asset.size,
      original_url: asset.original_url,
    },
    'workflow media output uploaded to R2',
  );

  return asset;
}

async function uploadFromUrl(args: {
  sourceUrl: string;
  outputType: NodeType;
  prefix: string;
  settings: R2Settings;
}): Promise<WorkflowOutputAsset> {
  const response = await fetch(args.sourceUrl, {
    redirect: 'follow',
    headers: {
      'user-agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
      accept: '*/*',
    },
    signal: AbortSignal.timeout(300_000),
  });

  if (!response.ok) {
    throw new Error(
      `Failed to download generated media: ${response.status} ${response.statusText}`,
    );
  }

  const body = Buffer.from(await response.arrayBuffer());
  const contentType =
    response.headers.get('content-type')?.split(';')[0]?.trim() ||
    fallbackContentType(args.outputType);

  const maxBytes = maxBytesFor(args.outputType);
  if (body.byteLength > maxBytes) {
    throw new Error(
      `Generated ${args.outputType} is too large (${(body.byteLength / 1024 / 1024).toFixed(
        1,
      )}MB > ${(maxBytes / 1024 / 1024).toFixed(0)}MB)`,
    );
  }

  return uploadBuffer({
    body,
    contentType,
    extension: extensionFor(contentType, args.outputType, args.sourceUrl),
    prefix: args.prefix,
    settings: args.settings,
    originalUrl: args.sourceUrl,
  });
}

function parseDataUrl(value: string): { body: Buffer; contentType: string } {
  const match = /^data:([^;,]+)?(;base64)?,(.*)$/s.exec(value);
  if (!match) throw new Error('Invalid data URL media output');

  const contentType = match[1]?.trim() || 'application/octet-stream';
  const isBase64 = Boolean(match[2]);
  const payload = match[3] ?? '';
  const body = isBase64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload));

  if (body.byteLength === 0) {
    throw new Error('Generated media output is empty');
  }

  return { body, contentType };
}

function readR2PublicUrl(value: string, settings: R2Settings): { key: string } | null {
  const base = settings.publicBaseUrl.replace(/\/+$/, '');
  if (!value.startsWith(`${base}/`)) return null;
  return { key: value.slice(base.length + 1) };
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

function extensionFor(contentType: string, outputType: NodeType, sourceUrl?: string): string {
  switch (contentType.toLowerCase()) {
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpg';
    case 'image/png':
      return 'png';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'video/mp4':
      return 'mp4';
    case 'video/webm':
      return 'webm';
    case 'video/quicktime':
      return 'mov';
    case 'audio/mpeg':
    case 'audio/mp3':
      return 'mp3';
    case 'audio/wav':
    case 'audio/x-wav':
      return 'wav';
    case 'audio/ogg':
      return 'ogg';
  }

  const ext = sourceUrl ? extensionFromUrl(sourceUrl) : null;
  if (ext) return ext;

  switch (outputType) {
    case 'image':
      return 'png';
    case 'video':
      return 'mp4';
    case 'audio':
      return 'mp3';
    case 'text':
      return 'txt';
  }
}

function extensionFromUrl(value: string): string | null {
  try {
    const pathname = new URL(value).pathname;
    const ext = pathname.split('.').pop()?.toLowerCase();
    if (!ext || ext.length > 8 || ext.includes('/')) return null;
    return ext;
  } catch {
    return null;
  }
}

function fallbackContentType(outputType: NodeType): string {
  switch (outputType) {
    case 'image':
      return 'image/png';
    case 'video':
      return 'video/mp4';
    case 'audio':
      return 'audio/mpeg';
    case 'text':
      return 'text/plain';
  }
}

function maxBytesFor(outputType: NodeType): number {
  switch (outputType) {
    case 'image':
      return 30 * 1024 * 1024;
    case 'audio':
      return 120 * 1024 * 1024;
    case 'video':
      return 800 * 1024 * 1024;
    case 'text':
      return 2 * 1024 * 1024;
  }
}
