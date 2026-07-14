import { createHash } from 'node:crypto';

const FULL_RELEASE_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const MANIFEST_PATH = 'release-manifest.json';
const READY_PATH = '_READY.json';

export async function publishImmutableRelease({
  inventory: rawInventory,
  store,
  concurrency = 8,
  dryRun = false,
}) {
  const inventory = normalizeInventory(rawInventory);
  const uploadConcurrency = normalizeConcurrency(concurrency);

  if (dryRun) {
    return {
      release: inventory.release,
      prefix: inventory.prefix,
      state: 'dry-run',
      action: 'plan',
      dryRun: true,
      objectCount: inventory.objects.length,
      putCount: 0,
      plannedPuts: inventory.objects.map((object) => object.key),
    };
  }

  requireStore(store);

  const manifest = inventory.objects.at(-2);
  const ready = inventory.objects.at(-1);
  const payload = inventory.objects.slice(0, -2);
  const expectedByKey = new Map(inventory.objects.map((object) => [object.key, object]));
  const initialKeys = await listKeys(store, inventory.prefix);
  requireNoUnknownKeys(initialKeys, expectedByKey, inventory.prefix);

  const initialKeySet = new Set(initialKeys);
  let action;
  let putCount = 0;

  if (initialKeySet.has(ready.key)) {
    action = 'already-sealed';
    await auditExactRelease(store, inventory, uploadConcurrency);
  } else if (initialKeySet.has(manifest.key)) {
    action = 'sealed-existing-manifest';
    requireExactKeys(
      initialKeys,
      inventory.objects.slice(0, -1).map((object) => object.key),
      'a release with a manifest but no READY marker',
    );
    await auditObjects(store, [...payload, manifest], uploadConcurrency);
    putCount += await ensureObject(store, ready);
    await auditExactRelease(store, inventory, uploadConcurrency);
  } else {
    action = 'published';
    requirePayloadSubset(initialKeys, new Set(payload.map((object) => object.key)));

    const initiallyPresent = payload.filter((object) => initialKeySet.has(object.key));
    await auditObjects(store, initiallyPresent, uploadConcurrency);

    const missingPayload = payload.filter((object) => !initialKeySet.has(object.key));
    const payloadPuts = await mapWithConcurrency(missingPayload, uploadConcurrency, (object) =>
      ensureObject(store, object),
    );
    putCount += payloadPuts.reduce((total, count) => total + count, 0);

    // The manifest is a one-way barrier: every payload object must be durable
    // and byte-for-byte identical before it can be created.
    await auditObjects(store, payload, uploadConcurrency);
    putCount += await ensureObject(store, manifest);
    await auditObject(store, manifest);

    // READY seals the namespace. It is always the final write.
    putCount += await ensureObject(store, ready);
    await auditExactRelease(store, inventory, uploadConcurrency);
  }

  return {
    release: inventory.release,
    prefix: inventory.prefix,
    state: 'sealed',
    action,
    dryRun: false,
    objectCount: inventory.objects.length,
    auditedObjectCount: inventory.objects.length,
    putCount,
  };
}

function normalizeInventory(inventory) {
  if (!inventory || typeof inventory !== 'object' || Array.isArray(inventory)) {
    throw new TypeError('release inventory must be an object');
  }
  if (!FULL_RELEASE_PATTERN.test(inventory.release)) {
    throw new Error('release inventory requires a full lowercase git SHA');
  }
  const expectedPrefix = `releases/${inventory.release}/`;
  if (inventory.prefix !== expectedPrefix) {
    throw new Error(`release inventory prefix must be ${expectedPrefix}`);
  }
  if (!Array.isArray(inventory.objects) || inventory.objects.length < 2) {
    throw new Error('release inventory must contain manifest and READY objects');
  }

  const objects = inventory.objects.map((object, index) =>
    normalizeObject(object, inventory.prefix, index, inventory.objects.length),
  );
  const manifest = objects.at(-2);
  const ready = objects.at(-1);
  if (manifest.relativePath !== MANIFEST_PATH || manifest.phase !== 'manifest') {
    throw new Error('release-manifest.json must be the penultimate inventory object');
  }
  if (ready.relativePath !== READY_PATH || ready.phase !== 'ready') {
    throw new Error('_READY.json must be the final inventory object');
  }
  if (objects.slice(0, -2).some((object) => object.phase !== 'payload')) {
    throw new Error('payload objects must precede release-manifest.json');
  }

  const keys = new Set();
  const relativePaths = new Set();
  for (const object of objects) {
    if (keys.has(object.key) || relativePaths.has(object.relativePath)) {
      throw new Error(`release inventory contains a duplicate object: ${object.relativePath}`);
    }
    keys.add(object.key);
    relativePaths.add(object.relativePath);
  }

  return { release: inventory.release, prefix: inventory.prefix, objects };
}

function normalizeObject(object, prefix, index, objectCount) {
  if (!object || typeof object !== 'object' || Array.isArray(object)) {
    throw new TypeError(`release inventory object ${index} must be an object`);
  }
  const relativePath = validateRelativePath(object.relativePath);
  if (object.key !== `${prefix}${relativePath}`) {
    throw new Error(`release inventory key does not match its prefix: ${object.key}`);
  }
  const bytes = normalizeBytes(object.bytes, `inventory object ${relativePath}`);
  if (!Number.isSafeInteger(object.size) || object.size < 0 || object.size !== bytes.byteLength) {
    throw new Error(`release inventory size does not match bytes: ${relativePath}`);
  }
  if (!SHA256_PATTERN.test(object.sha256) || digest(bytes) !== object.sha256) {
    throw new Error(`release inventory sha256 does not match bytes: ${relativePath}`);
  }
  if (
    typeof object.contentType !== 'string' ||
    object.contentType.trim() !== object.contentType ||
    object.contentType.length === 0 ||
    hasControlCharacter(object.contentType)
  ) {
    throw new Error(`release inventory has an invalid content type: ${relativePath}`);
  }
  if (
    object.contentEncoding !== undefined &&
    object.contentEncoding !== 'br' &&
    object.contentEncoding !== 'gzip'
  ) {
    throw new Error(`release inventory has an invalid content encoding: ${relativePath}`);
  }

  const inferredPhase =
    index === objectCount - 1 ? 'ready' : index === objectCount - 2 ? 'manifest' : 'payload';
  if (object.phase !== inferredPhase) {
    throw new Error(`release inventory has an invalid phase for ${relativePath}`);
  }

  return {
    key: object.key,
    relativePath,
    bytes,
    size: object.size,
    sha256: object.sha256,
    contentType: object.contentType,
    ...(object.contentEncoding ? { contentEncoding: object.contentEncoding } : {}),
    phase: inferredPhase,
  };
}

function validateRelativePath(relativePath) {
  if (
    typeof relativePath !== 'string' ||
    relativePath.length === 0 ||
    relativePath.startsWith('/') ||
    relativePath.includes('\\') ||
    relativePath.includes('?') ||
    relativePath.includes('#') ||
    hasControlCharacter(relativePath)
  ) {
    throw new Error(`unsafe release inventory path: ${relativePath}`);
  }
  const parts = relativePath.split('/');
  if (parts.some((part) => part.length === 0 || part === '.' || part === '..')) {
    throw new Error(`unsafe release inventory path: ${relativePath}`);
  }
  return relativePath;
}

function hasControlCharacter(value) {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= 31 || code === 127) return true;
  }
  return false;
}

function normalizeConcurrency(concurrency) {
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) {
    throw new Error('release upload concurrency must be a positive integer');
  }
  return concurrency;
}

function requireStore(store) {
  if (!store || typeof store !== 'object') {
    throw new TypeError('release store must be an object');
  }
  for (const method of ['list', 'head', 'getBytes', 'putIfAbsent']) {
    if (typeof store[method] !== 'function') {
      throw new TypeError(`release store must implement ${method}()`);
    }
  }
}

async function listKeys(store, prefix) {
  const result = await store.list(prefix);
  const entries = Array.isArray(result) ? result : result?.objects;
  if (!Array.isArray(entries)) {
    throw new Error('release store list() must return an array or { objects: [] }');
  }
  const keys = entries.map((entry) => (typeof entry === 'string' ? entry : entry?.key));
  if (keys.some((key) => typeof key !== 'string' || !key.startsWith(prefix))) {
    throw new Error(`release store returned an invalid key for prefix ${prefix}`);
  }
  if (new Set(keys).size !== keys.length) {
    throw new Error(`release store returned duplicate keys for prefix ${prefix}`);
  }
  return [...keys].sort();
}

function requireNoUnknownKeys(actualKeys, expectedByKey, prefix) {
  const unknown = actualKeys.filter((key) => !expectedByKey.has(key));
  if (unknown.length > 0) {
    throw new Error(
      `release namespace ${prefix} contains unexpected objects: ${unknown.join(', ')}`,
    );
  }
}

function requirePayloadSubset(actualKeys, payloadKeys) {
  const invalid = actualKeys.filter((key) => !payloadKeys.has(key));
  if (invalid.length > 0) {
    throw new Error(`unsealed release contains non-payload objects: ${invalid.join(', ')}`);
  }
}

function requireExactKeys(actualKeys, expectedKeys, label) {
  const actual = [...actualKeys].sort();
  const expected = [...expectedKeys].sort();
  const missing = expected.filter((key) => !actual.includes(key));
  const unexpected = actual.filter((key) => !expected.includes(key));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `${label} has an invalid object set (missing: ${missing.join(', ') || 'none'}; unexpected: ${unexpected.join(', ') || 'none'})`,
    );
  }
}

async function auditExactRelease(store, inventory, concurrency) {
  const keys = await listKeys(store, inventory.prefix);
  requireExactKeys(
    keys,
    inventory.objects.map((object) => object.key),
    'sealed release',
  );
  await auditObjects(store, inventory.objects, concurrency);
}

async function auditObjects(store, objects, concurrency) {
  await mapWithConcurrency(objects, concurrency, (object) => auditObject(store, object));
}

async function auditObject(store, object) {
  const metadata = await store.head(object.key);
  if (!metadata) throw new Error(`release object is missing: ${object.key}`);

  const actualMetadata = readMetadata(metadata);
  if (actualMetadata.size !== object.size) {
    throw new Error(`release object size conflicts with inventory: ${object.key}`);
  }
  if (actualMetadata.sha256 !== object.sha256) {
    throw new Error(`release object sha256 metadata conflicts with inventory: ${object.key}`);
  }
  if (actualMetadata.contentType !== object.contentType) {
    throw new Error(`release object content type conflicts with inventory: ${object.key}`);
  }
  if ((actualMetadata.contentEncoding ?? undefined) !== object.contentEncoding) {
    throw new Error(`release object content encoding conflicts with inventory: ${object.key}`);
  }

  const actualBytes = normalizeBytes(
    await store.getBytes(object.key),
    `stored release object ${object.key}`,
  );
  if (
    actualBytes.byteLength !== object.size ||
    digest(actualBytes) !== object.sha256 ||
    !actualBytes.equals(object.bytes)
  ) {
    throw new Error(`release object bytes conflict with inventory: ${object.key}`);
  }
}

function readMetadata(metadata) {
  return {
    size: metadata.size,
    sha256: metadata.sha256 ?? metadata.customMetadata?.sha256,
    contentType: metadata.contentType ?? metadata.httpMetadata?.contentType,
    contentEncoding:
      metadata.contentEncoding ?? metadata.httpMetadata?.contentEncoding ?? undefined,
  };
}

async function ensureObject(store, object) {
  const existing = await store.head(object.key);
  if (existing) {
    await auditObject(store, object);
    return 0;
  }

  const created = await store.putIfAbsent({
    key: object.key,
    relativePath: object.relativePath,
    bytes: object.bytes,
    size: object.size,
    sha256: object.sha256,
    contentType: object.contentType,
    ...(object.contentEncoding ? { contentEncoding: object.contentEncoding } : {}),
    phase: object.phase,
  });
  if (created !== true && created !== false) {
    throw new Error('release store putIfAbsent() must return a boolean');
  }
  await auditObject(store, object);
  return created ? 1 : 0;
}

async function mapWithConcurrency(items, concurrency, callback) {
  if (items.length === 0) return [];
  const results = new Array(items.length);
  let nextIndex = 0;
  let firstFailure = null;

  async function worker() {
    while (!firstFailure) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) return;
      try {
        results[index] = await callback(items[index], index);
      } catch (error) {
        firstFailure ??= error;
      }
    }
  }

  const workerCount = Math.min(concurrency, items.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));
  if (firstFailure) throw firstFailure;
  return results;
}

function normalizeBytes(bytes, label) {
  if (Buffer.isBuffer(bytes)) return Buffer.from(bytes);
  if (bytes instanceof Uint8Array) {
    return Buffer.from(bytes);
  }
  if (bytes instanceof ArrayBuffer) return Buffer.from(new Uint8Array(bytes));
  throw new TypeError(`${label} must provide bytes as Buffer, Uint8Array, or ArrayBuffer`);
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
