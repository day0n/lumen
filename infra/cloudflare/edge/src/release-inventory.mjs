import { createHash } from 'node:crypto';
import { lstat, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { validateReleasePath } from './release-path.mjs';

const FULL_RELEASE_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MANIFEST_FILENAME = 'release-manifest.json';
const READY_FILENAME = '_READY.json';
const JSON_METADATA = { contentType: 'application/json; charset=utf-8' };
const RELEASE_SCOPE = ['app', 'share'];
const RELEASE_SHELLS = {
  app: 'app/index.html',
  share: 'share/index.html',
};

export async function verifyReleaseDirectory({ release, releaseDirectory }) {
  requireRelease(release);
  if (typeof releaseDirectory !== 'string' || !releaseDirectory) {
    throw new Error('release directory is required');
  }

  const rootStats = await lstat(releaseDirectory).catch(() => null);
  if (!rootStats?.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error(`release directory is missing or unsafe: ${releaseDirectory}`);
  }

  const localFiles = await listLocalFiles(releaseDirectory);
  const localFileSet = new Set(localFiles);
  for (const requiredPath of [MANIFEST_FILENAME, READY_FILENAME]) {
    if (!localFileSet.has(requiredPath)) {
      throw new Error(`release inventory is missing ${requiredPath}`);
    }
  }

  const [manifestBytes, readyBytes] = await Promise.all([
    readReleaseFile(releaseDirectory, MANIFEST_FILENAME),
    readReleaseFile(releaseDirectory, READY_FILENAME),
  ]);
  const manifest = parseJson(manifestBytes, 'release manifest');
  const ready = parseJson(readyBytes, 'release readiness marker');

  verifyManifest(manifest, release);

  const payloadPaths = manifest.files.map((entry) => entry.path);
  const expectedLocalFiles = [...payloadPaths, MANIFEST_FILENAME, READY_FILENAME].sort();
  if (!arraysEqual(localFiles, expectedLocalFiles)) {
    const expectedFileSet = new Set(expectedLocalFiles);
    const extra = localFiles.filter((filename) => !expectedFileSet.has(filename));
    const missing = expectedLocalFiles.filter((filename) => !localFileSet.has(filename));
    throw new Error(
      `release inventory does not match manifest${extra.length ? `; extra: ${extra.join(', ')}` : ''}${missing.length ? `; missing: ${missing.join(', ')}` : ''}`,
    );
  }
  verifyReady(ready, release, manifest, manifestBytes, localFiles.length);

  const payloadPathSet = new Set(payloadPaths);
  const payloadObjects = [];
  for (const entry of manifest.files) {
    verifyCompressionSibling(entry, payloadPathSet);
    const bytes = await readReleaseFile(releaseDirectory, entry.path);
    if (bytes.byteLength !== entry.size) {
      throw new Error(`release object size does not match manifest: ${entry.path}`);
    }
    if (digest(bytes) !== entry.sha256) {
      throw new Error(`release object hash does not match manifest: ${entry.path}`);
    }
    payloadObjects.push(
      createUploadObject(
        release,
        entry.path,
        bytes,
        {
          contentType: entry.contentType,
          ...(entry.contentEncoding ? { contentEncoding: entry.contentEncoding } : {}),
        },
        'payload',
      ),
    );
  }

  return {
    release,
    prefix: `releases/${release}/`,
    releaseDirectory,
    manifest,
    ready,
    objects: [
      ...payloadObjects,
      createUploadObject(release, MANIFEST_FILENAME, manifestBytes, JSON_METADATA, 'manifest'),
      createUploadObject(release, READY_FILENAME, readyBytes, JSON_METADATA, 'ready'),
    ],
  };
}

export function verifyReleaseInventoryObjects({ release, objects }) {
  requireRelease(release);
  if (!Array.isArray(objects) || objects.length < 2) {
    throw new Error('release inventory must contain manifest and READY objects');
  }

  const payloadObjects = objects.slice(0, -2);
  const manifestObject = objects.at(-2);
  const readyObject = objects.at(-1);
  if (
    manifestObject?.relativePath !== MANIFEST_FILENAME ||
    readyObject?.relativePath !== READY_FILENAME
  ) {
    throw new Error('release inventory metadata objects are out of order');
  }

  const manifestBytes = normalizeObjectBytes(manifestObject.bytes, MANIFEST_FILENAME);
  const readyBytes = normalizeObjectBytes(readyObject.bytes, READY_FILENAME);
  if (
    manifestObject.contentType !== JSON_METADATA.contentType ||
    manifestObject.contentEncoding !== undefined ||
    readyObject.contentType !== JSON_METADATA.contentType ||
    readyObject.contentEncoding !== undefined
  ) {
    throw new Error('release manifest and READY objects must use canonical JSON metadata');
  }
  const manifest = parseJson(manifestBytes, 'release manifest');
  const ready = parseJson(readyBytes, 'release readiness marker');
  verifyManifest(manifest, release);
  verifyReady(ready, release, manifest, manifestBytes, objects.length);

  if (manifest.files.length !== payloadObjects.length) {
    throw new Error('release manifest payload count does not match inventory objects');
  }
  for (let index = 0; index < manifest.files.length; index += 1) {
    const entry = manifest.files[index];
    const object = payloadObjects[index];
    if (
      object.relativePath !== entry.path ||
      object.size !== entry.size ||
      object.sha256 !== entry.sha256 ||
      object.contentType !== entry.contentType ||
      (object.contentEncoding ?? undefined) !== entry.contentEncoding
    ) {
      throw new Error(`release manifest file does not match inventory object: ${entry.path}`);
    }
  }

  return { manifest, ready };
}

function verifyManifest(manifest, release) {
  requireRecord(manifest, 'release manifest');
  requireExactKeys(
    manifest,
    [
      'schemaVersion',
      'release',
      'scope',
      'shells',
      'assetBase',
      'buildConfigFingerprint',
      'buildMetadataSha256',
      'sourceManifestSha256',
      'files',
    ],
    'release manifest',
  );
  if (manifest.schemaVersion !== 1 || manifest.release !== release) {
    throw new Error('release manifest identity does not match the requested release');
  }
  requireReleaseScope(manifest.scope, 'release manifest');
  requireRecord(manifest.shells, 'release manifest shells');
  requireExactKeys(manifest.shells, Object.keys(RELEASE_SHELLS), 'release manifest shells');
  for (const [shellName, shellPath] of Object.entries(RELEASE_SHELLS)) {
    if (manifest.shells[shellName] !== shellPath) {
      throw new Error(`release manifest must declare the ${shellName} shell`);
    }
  }
  if (manifest.assetBase !== `/_static/releases/${release}/`) {
    throw new Error('release manifest asset base does not match the requested release');
  }
  for (const field of ['buildConfigFingerprint', 'buildMetadataSha256', 'sourceManifestSha256']) {
    if (typeof manifest[field] !== 'string' || !SHA256_PATTERN.test(manifest[field])) {
      throw new Error(`release manifest ${field} must be a lowercase SHA-256 digest`);
    }
  }
  if (!Array.isArray(manifest.files) || manifest.files.length === 0) {
    throw new Error('release manifest must contain payload files');
  }

  const paths = [];
  for (const entry of manifest.files) {
    verifyManifestEntry(entry);
    paths.push(entry.path);
  }
  const sortedPaths = [...paths].sort();
  if (!arraysEqual(paths, sortedPaths)) {
    throw new Error('release manifest paths must be sorted');
  }
  if (new Set(paths).size !== paths.length) {
    throw new Error('release manifest paths must be unique');
  }
  for (const [shellName, shellPath] of Object.entries(RELEASE_SHELLS)) {
    if (!paths.includes(shellPath)) {
      throw new Error(`release manifest ${shellName} shell is missing from the payload`);
    }
  }
}

function verifyManifestEntry(entry) {
  requireRecord(entry, 'release manifest file');
  const encoded = Object.hasOwn(entry, 'contentEncoding');
  requireExactKeys(
    entry,
    ['path', 'size', 'sha256', 'contentType', ...(encoded ? ['contentEncoding'] : [])],
    'release manifest file',
  );
  const relativePath = validateReleasePath(entry.path);
  if (relativePath === MANIFEST_FILENAME || relativePath === READY_FILENAME) {
    throw new Error(`release payload uses a reserved path: ${relativePath}`);
  }
  if (!Number.isSafeInteger(entry.size) || entry.size < 0) {
    throw new Error(`release object size is invalid: ${relativePath}`);
  }
  if (typeof entry.sha256 !== 'string' || !SHA256_PATTERN.test(entry.sha256)) {
    throw new Error(`release object hash is invalid: ${relativePath}`);
  }

  const compression = compressionFor(relativePath);
  if (compression && entry.contentEncoding !== compression.encoding) {
    throw new Error(`release object content encoding is invalid: ${relativePath}`);
  }
  if (!compression && encoded) {
    throw new Error(`release object must not declare content encoding: ${relativePath}`);
  }
  const sourcePath = compression?.sourcePath ?? relativePath;
  if (sourcePath.endsWith('.br') || sourcePath.endsWith('.gz')) {
    throw new Error(`release object has nested compression suffixes: ${relativePath}`);
  }
  validateReleasePath(sourcePath);
  const expectedContentType = contentTypeFor(sourcePath);
  if (entry.contentType !== expectedContentType) {
    throw new Error(`release object content type is invalid: ${relativePath}`);
  }
}

function verifyReady(ready, release, manifest, manifestBytes, localObjectCount) {
  requireRecord(ready, 'release readiness marker');
  requireExactKeys(
    ready,
    ['schemaVersion', 'release', 'scope', 'manifest', 'objectCount'],
    'release readiness marker',
  );
  if (ready.schemaVersion !== 1 || ready.release !== release) {
    throw new Error('release readiness marker identity does not match the requested release');
  }
  requireReleaseScope(ready.scope, 'release readiness marker');
  requireRecord(ready.manifest, 'release readiness manifest reference');
  requireExactKeys(ready.manifest, ['path', 'sha256'], 'release readiness manifest reference');
  if (ready.manifest.path !== MANIFEST_FILENAME) {
    throw new Error('release readiness marker references an invalid manifest path');
  }
  if (typeof ready.manifest.sha256 !== 'string' || !SHA256_PATTERN.test(ready.manifest.sha256)) {
    throw new Error('release readiness marker contains an invalid manifest hash');
  }
  if (ready.manifest.sha256 !== digest(manifestBytes)) {
    throw new Error('release readiness marker does not match the raw manifest hash');
  }
  const expectedObjectCount = manifest.files.length + 2;
  if (
    !Number.isSafeInteger(ready.objectCount) ||
    ready.objectCount !== expectedObjectCount ||
    ready.objectCount !== localObjectCount
  ) {
    throw new Error('release readiness object count does not match the release inventory');
  }
}

function verifyCompressionSibling(entry, payloadPaths) {
  const compression = compressionFor(entry.path);
  if (compression && !payloadPaths.has(compression.sourcePath)) {
    throw new Error(`compressed release object is missing its source sibling: ${entry.path}`);
  }
}

async function listLocalFiles(directory, relativeDirectory = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = validateReleasePath(
      relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name,
    );
    const absolutePath = path.join(directory, entry.name);
    const stats = await lstat(absolutePath);
    if (stats.isSymbolicLink()) {
      throw new Error(`release inventory must not contain symbolic links: ${relativePath}`);
    }
    if (stats.isDirectory()) {
      files.push(...(await listLocalFiles(absolutePath, relativePath)));
    } else if (stats.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`release inventory must contain only regular files: ${relativePath}`);
    }
  }
  return files.sort();
}

async function readReleaseFile(releaseDirectory, relativePath) {
  return readFile(path.join(releaseDirectory, ...relativePath.split('/')));
}

function parseJson(bytes, label) {
  try {
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`${label} is not valid JSON`, { cause: error });
  }
}

function normalizeObjectBytes(bytes, label) {
  if (Buffer.isBuffer(bytes)) return bytes;
  if (bytes instanceof Uint8Array) return Buffer.from(bytes);
  if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
  throw new TypeError(`${label} must provide bytes`);
}

function requireRelease(release) {
  if (typeof release !== 'string' || !FULL_RELEASE_PATTERN.test(release)) {
    throw new Error('release must be a full 40-character lowercase git SHA');
  }
}

function requireReleaseScope(scope, label) {
  if (!Array.isArray(scope) || !arraysEqual(scope, RELEASE_SCOPE)) {
    throw new Error(`${label} scope must be exactly app, share`);
  }
}

function requireRecord(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} must be an object`);
  }
}

function requireExactKeys(value, expectedKeys, label) {
  const actualKeys = Object.keys(value).sort();
  const sortedExpectedKeys = [...expectedKeys].sort();
  if (!arraysEqual(actualKeys, sortedExpectedKeys)) {
    throw new Error(`${label} has an invalid schema`);
  }
}

function compressionFor(filename) {
  if (filename.endsWith('.br')) {
    return { encoding: 'br', sourcePath: filename.slice(0, -3) };
  }
  if (filename.endsWith('.gz')) {
    return { encoding: 'gzip', sourcePath: filename.slice(0, -3) };
  }
  return null;
}

function contentTypeFor(filename) {
  if (filename.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filename.endsWith('.css')) return 'text/css; charset=utf-8';
  if (filename.endsWith('.js') || filename.endsWith('.mjs')) {
    return 'text/javascript; charset=utf-8';
  }
  if (filename.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filename.endsWith('.svg')) return 'image/svg+xml';
  if (filename.endsWith('.png')) return 'image/png';
  if (filename.endsWith('.jpg') || filename.endsWith('.jpeg')) return 'image/jpeg';
  if (filename.endsWith('.webp')) return 'image/webp';
  if (filename.endsWith('.woff2')) return 'font/woff2';
  if (filename.endsWith('.ico')) return 'image/x-icon';
  return 'application/octet-stream';
}

function createUploadObject(release, relativePath, bytes, metadata, phase) {
  return {
    relativePath,
    path: relativePath,
    key: `releases/${release}/${relativePath}`,
    bytes,
    size: bytes.byteLength,
    sha256: digest(bytes),
    contentType: metadata.contentType,
    ...(metadata.contentEncoding ? { contentEncoding: metadata.contentEncoding } : {}),
    phase,
    metadata: { ...metadata },
  };
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function arraysEqual(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
