import { createHash } from 'node:crypto';
import { hasControlCharacter, validateReleasePath } from './release-path.mjs';

const FULL_RELEASE_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMAND_NAMES = ['listObjectsV2', 'headObject', 'getObject', 'putObject'];

export function createR2ReleaseStore({
  accountId,
  bucket,
  accessKeyId,
  secretAccessKey,
  client: providedClient,
  commandFactory: providedCommandFactory,
}) {
  const settings = {
    accountId: requireAccountId(accountId),
    bucket: requireSetting(bucket, 'R2 bucket'),
    accessKeyId: requireSetting(accessKeyId, 'R2 access key ID'),
    secretAccessKey: requireSetting(secretAccessKey, 'R2 secret access key'),
  };
  if (providedClient !== undefined && typeof providedClient?.send !== 'function') {
    throw new TypeError('R2 client must implement send()');
  }
  if (
    providedCommandFactory !== undefined &&
    typeof providedCommandFactory !== 'function' &&
    !isCommandFactoryObject(providedCommandFactory)
  ) {
    throw new TypeError('R2 command factory must create every required S3 command');
  }

  let runtimePromise;
  const getRuntime = () => {
    runtimePromise ??= createRuntime({
      ...settings,
      providedClient,
      providedCommandFactory,
    });
    return runtimePromise;
  };

  return {
    async list(prefix) {
      requireNonEmptyString(prefix, 'release prefix');
      const runtime = await getRuntime();
      const objects = [];
      const seenKeys = new Set();
      const seenTokens = new Set();
      let continuationToken;

      for (;;) {
        const response = await runtime.client.send(
          createCommand(runtime.commandFactory, 'listObjectsV2', {
            Bucket: settings.bucket,
            Prefix: prefix,
            ...(continuationToken ? { ContinuationToken: continuationToken } : {}),
          }),
        );

        for (const entry of response?.Contents ?? []) {
          if (typeof entry?.Key !== 'string' || !entry.Key.startsWith(prefix)) {
            throw new Error(`R2 returned an invalid object key for prefix ${prefix}`);
          }
          if (seenKeys.has(entry.Key)) {
            throw new Error(`R2 returned a duplicate object key: ${entry.Key}`);
          }
          seenKeys.add(entry.Key);
          objects.push({ key: entry.Key });
        }

        if (!response?.IsTruncated) break;
        const nextToken = response.NextContinuationToken;
        if (typeof nextToken !== 'string' || nextToken.length === 0 || seenTokens.has(nextToken)) {
          throw new Error('R2 returned an invalid continuation token');
        }
        seenTokens.add(nextToken);
        continuationToken = nextToken;
      }

      objects.sort((left, right) => left.key.localeCompare(right.key));
      return { objects };
    },

    async head(key) {
      requireNonEmptyString(key, 'release object key');
      const runtime = await getRuntime();
      const stored = await readStoredMetadata(runtime, settings.bucket, key);
      if (!stored) return null;
      return publicMetadata(stored);
    },

    async getBytes(key) {
      requireNonEmptyString(key, 'release object key');
      const runtime = await getRuntime();
      return readStoredBytes(runtime, settings.bucket, key);
    },

    async putIfAbsent(rawObject) {
      const object = normalizeUploadObject(rawObject);
      const runtime = await getRuntime();

      try {
        await runtime.client.send(
          createCommand(runtime.commandFactory, 'putObject', {
            Bucket: settings.bucket,
            Key: object.key,
            Body: object.bytes,
            IfNoneMatch: '*',
            ContentLength: object.size,
            ContentType: object.contentType,
            ...(object.contentEncoding ? { ContentEncoding: object.contentEncoding } : {}),
            Metadata: {
              sha256: object.sha256,
              release: object.release,
            },
            ContentMD5: createHash('md5').update(object.bytes).digest('base64'),
          }),
        );
        return true;
      } catch (error) {
        if (!isConditionalWriteConflict(error)) throw error;
        await requireIdenticalStoredObject(runtime, settings.bucket, object, error);
        return false;
      }
    },
  };
}

async function createRuntime({
  accountId,
  accessKeyId,
  secretAccessKey,
  providedClient,
  providedCommandFactory,
}) {
  let sdk;
  if (!providedClient || !providedCommandFactory) {
    sdk = await import('@aws-sdk/client-s3');
  }

  const client =
    providedClient ??
    new sdk.S3Client({
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      region: 'auto',
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
      requestChecksumCalculation: 'WHEN_REQUIRED',
      responseChecksumValidation: 'WHEN_REQUIRED',
    });
  const commandFactory = providedCommandFactory ?? createSdkCommandFactory(sdk);
  return { client, commandFactory };
}

function createSdkCommandFactory(sdk) {
  const constructors = {
    listObjectsV2: sdk.ListObjectsV2Command,
    headObject: sdk.HeadObjectCommand,
    getObject: sdk.GetObjectCommand,
    putObject: sdk.PutObjectCommand,
  };
  if (COMMAND_NAMES.some((name) => typeof constructors[name] !== 'function')) {
    throw new Error('installed S3 client does not provide the required commands');
  }
  return (name, input) => new constructors[name](input);
}

function isCommandFactoryObject(factory) {
  return (
    factory &&
    typeof factory === 'object' &&
    COMMAND_NAMES.every((name) => typeof factory[name] === 'function')
  );
}

function createCommand(factory, name, input) {
  const command =
    typeof factory === 'function' ? factory(name, input) : factory[name].call(factory, input);
  if (!command || typeof command !== 'object') {
    throw new Error(`R2 command factory returned an invalid ${name} command`);
  }
  return command;
}

async function readStoredMetadata(runtime, bucket, key) {
  try {
    const response = await runtime.client.send(
      createCommand(runtime.commandFactory, 'headObject', { Bucket: bucket, Key: key }),
    );
    const customMetadata = normalizeCustomMetadata(response?.Metadata);
    return {
      size: response?.ContentLength,
      sha256: customMetadata.sha256,
      release: customMetadata.release,
      customMetadata,
      contentType: response?.ContentType,
      contentEncoding: response?.ContentEncoding,
    };
  } catch (error) {
    if (isMissingObject(error)) return null;
    throw error;
  }
}

async function readStoredBytes(runtime, bucket, key) {
  try {
    const response = await runtime.client.send(
      createCommand(runtime.commandFactory, 'getObject', { Bucket: bucket, Key: key }),
    );
    if (response?.Body === undefined || response.Body === null) {
      if (response?.ContentLength === 0) return Buffer.alloc(0);
      throw new Error(`R2 returned no body for object ${key}`);
    }
    return collectBody(response.Body, key);
  } catch (error) {
    if (isMissingObject(error)) return null;
    throw error;
  }
}

async function requireIdenticalStoredObject(runtime, bucket, object, conflictError) {
  const metadata = await readStoredMetadata(runtime, bucket, object.key);
  const bytes = await readStoredBytes(runtime, bucket, object.key);
  const customMetadataKeys = metadata ? Object.keys(metadata.customMetadata).sort() : [];
  const identical =
    metadata !== null &&
    bytes !== null &&
    metadata.size === object.size &&
    metadata.sha256 === object.sha256 &&
    metadata.release === object.release &&
    metadata.contentType === object.contentType &&
    (metadata.contentEncoding ?? undefined) === object.contentEncoding &&
    arraysEqual(customMetadataKeys, ['release', 'sha256']) &&
    bytes.byteLength === object.size &&
    createHash('sha256').update(bytes).digest('hex') === object.sha256 &&
    bytes.equals(object.bytes);

  if (!identical) {
    throw new Error(`immutable release object conflicts with existing data: ${object.key}`, {
      cause: conflictError,
    });
  }
}

function publicMetadata(stored) {
  return {
    size: stored.size,
    sha256: stored.sha256,
    release: stored.release,
    customMetadata: stored.customMetadata,
    contentType: stored.contentType,
    ...(stored.contentEncoding ? { contentEncoding: stored.contentEncoding } : {}),
  };
}

async function collectBody(body, key) {
  if (Buffer.isBuffer(body)) return Buffer.from(body);
  if (body instanceof Uint8Array) return Buffer.from(body);
  if (body instanceof ArrayBuffer) return Buffer.from(new Uint8Array(body));
  if (ArrayBuffer.isView(body)) {
    return Buffer.from(body.buffer, body.byteOffset, body.byteLength);
  }
  if (typeof body.transformToByteArray === 'function') {
    return Buffer.from(await body.transformToByteArray());
  }
  if (typeof body.arrayBuffer === 'function') {
    return Buffer.from(await body.arrayBuffer());
  }
  if (typeof body[Symbol.asyncIterator] === 'function') {
    const chunks = [];
    for await (const chunk of body) chunks.push(normalizeBodyChunk(chunk, key));
    return Buffer.concat(chunks);
  }
  if (typeof body.getReader === 'function') {
    const reader = body.getReader();
    const chunks = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(normalizeBodyChunk(value, key));
      }
    } finally {
      reader.releaseLock?.();
    }
    return Buffer.concat(chunks);
  }
  throw new TypeError(`R2 returned an unsupported body for object ${key}`);
}

function normalizeBodyChunk(chunk, key) {
  if (Buffer.isBuffer(chunk)) return chunk;
  if (chunk instanceof Uint8Array) return Buffer.from(chunk);
  if (chunk instanceof ArrayBuffer) return Buffer.from(new Uint8Array(chunk));
  if (typeof chunk === 'string') return Buffer.from(chunk);
  throw new TypeError(`R2 returned an unsupported body chunk for object ${key}`);
}

function normalizeUploadObject(object) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    throw new TypeError('release upload object must be an object');
  }
  const key = requireNonEmptyString(object.key, 'release object key');
  const releaseMatch = /^releases\/([0-9a-f]{40})\/(.+)$/.exec(key);
  const claimMatch = /^release-claims\/([0-9a-f]{40})\.json$/.exec(key);
  const release = releaseMatch?.[1] ?? claimMatch?.[1];
  if (!release || !FULL_RELEASE_PATTERN.test(release)) {
    throw new Error(`release object key does not contain a full release SHA: ${key}`);
  }
  try {
    validateReleasePath(releaseMatch?.[2] ?? key);
  } catch (error) {
    throw new Error(`release object key contains an unsafe path: ${key}`, { cause: error });
  }
  const bytes = normalizeBytes(object.bytes, key);
  if (!Number.isSafeInteger(object.size) || object.size < 0 || object.size !== bytes.byteLength) {
    throw new Error(`release object size does not match bytes: ${key}`);
  }
  if (
    typeof object.sha256 !== 'string' ||
    !SHA256_PATTERN.test(object.sha256) ||
    createHash('sha256').update(bytes).digest('hex') !== object.sha256
  ) {
    throw new Error(`release object sha256 does not match bytes: ${key}`);
  }
  const contentType = requireNonEmptyString(object.contentType, 'release object content type');
  if (contentType.trim() !== contentType || hasControlCharacter(contentType)) {
    throw new Error(`release object has an invalid content type: ${key}`);
  }
  if (
    object.contentEncoding !== undefined &&
    object.contentEncoding !== 'br' &&
    object.contentEncoding !== 'gzip'
  ) {
    throw new Error(`release object has an invalid content encoding: ${key}`);
  }

  return {
    key,
    release,
    bytes,
    size: object.size,
    sha256: object.sha256,
    contentType,
    contentEncoding: object.contentEncoding,
  };
}

function normalizeBytes(bytes, key) {
  if (Buffer.isBuffer(bytes)) return Buffer.from(bytes);
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
  throw new TypeError(`release object must provide bytes: ${key}`);
}

function normalizeCustomMetadata(metadata) {
  if (metadata === undefined || metadata === null) return {};
  if (typeof metadata !== 'object' || Array.isArray(metadata)) {
    throw new Error('R2 returned invalid custom metadata');
  }
  const normalized = {};
  for (const [rawKey, value] of Object.entries(metadata)) {
    const key = rawKey.toLowerCase();
    if (Object.hasOwn(normalized, key)) {
      throw new Error(`R2 returned duplicate custom metadata: ${key}`);
    }
    normalized[key] = value;
  }
  return normalized;
}

function isMissingObject(error) {
  const status = error?.$metadata?.httpStatusCode;
  return (
    status === 404 ||
    error?.name === 'NotFound' ||
    error?.name === 'NoSuchKey' ||
    error?.Code === 'NotFound' ||
    error?.Code === 'NoSuchKey'
  );
}

function isConditionalWriteConflict(error) {
  const status = error?.$metadata?.httpStatusCode;
  return (
    status === 409 ||
    status === 412 ||
    error?.name === 'PreconditionFailed' ||
    error?.name === 'ConditionalRequestConflict' ||
    error?.Code === 'PreconditionFailed' ||
    error?.Code === 'ConditionalRequestConflict'
  );
}

function requireSetting(value, label) {
  const setting = requireNonEmptyString(value, label);
  if (setting.trim() !== setting || hasControlCharacter(setting)) {
    throw new Error(`${label} is invalid`);
  }
  return setting;
}

function requireAccountId(value) {
  const accountId = requireSetting(value, 'R2 account ID');
  if (!/^[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?$/.test(accountId)) {
    throw new Error('R2 account ID is invalid');
  }
  return accountId;
}

function requireNonEmptyString(value, label) {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
