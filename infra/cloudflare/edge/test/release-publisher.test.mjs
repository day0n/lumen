import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { publishImmutableRelease } from '../src/release-publisher.mjs';

const RELEASE = '0123456789abcdef0123456789abcdef01234567';

test('dry-run validates and plans the release without touching the store', async () => {
  const inventory = createInventory(2);
  const store = new Proxy(
    {},
    {
      get() {
        throw new Error('dry-run accessed the store');
      },
    },
  );

  const result = await publishImmutableRelease({ inventory, store, dryRun: true });

  assert.equal(result.state, 'dry-run');
  assert.equal(result.putCount, 0);
  assert.deepEqual(
    result.plannedPuts,
    inventory.objects.map((object) => object.key),
  );
});

test('fills a payload subset with bounded concurrency and writes barriers in order', async () => {
  const inventory = createInventory(6);
  const store = new FakeStore({ putDelay: 8 });
  store.seed(inventory.objects[0]);

  const result = await publishImmutableRelease({ inventory, store, concurrency: 2 });

  assert.equal(result.state, 'sealed');
  assert.equal(result.action, 'published');
  assert.equal(result.putCount, inventory.objects.length - 1);
  assert.ok(store.maximumActivePuts > 1);
  assert.ok(store.maximumActivePuts <= 2);

  const putStarts = store.events.filter((event) => event.type === 'put-start');
  const manifestStart = putStarts.findIndex((event) => event.object.phase === 'manifest');
  const readyStart = putStarts.findIndex((event) => event.object.phase === 'ready');
  assert.equal(readyStart, putStarts.length - 1);
  assert.ok(manifestStart > 0);
  assert.ok(
    store.events
      .slice(0, store.events.indexOf(putStarts[manifestStart]))
      .filter((event) => event.type === 'put-end' && event.object.phase === 'payload').length >= 5,
  );
  assert.equal(
    store.events
      .slice(store.events.indexOf(putStarts[manifestStart]) + 1)
      .some((event) => event.type === 'put-start' && event.object.phase === 'payload'),
    false,
  );

  assert.deepEqual(
    [...store.objects.keys()].sort(),
    inventory.objects.map((object) => object.key).sort(),
  );
});

test('audits a sealed release on rerun without issuing any PUT', async () => {
  const inventory = createInventory(3);
  const store = new FakeStore();
  await publishImmutableRelease({ inventory, store });
  store.events.length = 0;

  const result = await publishImmutableRelease({ inventory, store });

  assert.equal(result.action, 'already-sealed');
  assert.equal(result.putCount, 0);
  assert.equal(
    store.events.some((event) => event.type === 'put-start'),
    false,
  );
  assert.equal(
    store.events.filter((event) => event.type === 'get').length,
    inventory.objects.length,
  );
});

test('accepts a concurrent identical create without overcounting it', async () => {
  const inventory = createInventory(1);
  const racedObject = inventory.objects[0];
  const store = new FakeStore({ raceKeys: [racedObject.key] });

  const result = await publishImmutableRelease({ inventory, store });

  assert.equal(result.state, 'sealed');
  assert.equal(result.putCount, inventory.objects.length - 1);
  assert.deepEqual(
    [...store.objects.keys()].sort(),
    inventory.objects.map((object) => object.key).sort(),
  );
});

test('rejects a concurrent conflicting create without overwriting it', async () => {
  const inventory = createInventory(1);
  const racedObject = inventory.objects[0];
  const store = new FakeStore({
    raceKeys: [racedObject.key],
    conflictingRaceKeys: [racedObject.key],
  });

  await assert.rejects(publishImmutableRelease({ inventory, store }), /conflict/);

  assert.equal(store.objects.get(racedObject.key).bytes.toString(), 'concurrent-conflict');
  assert.equal(store.objects.has(inventory.objects.at(-2).key), false);
  assert.equal(store.objects.has(inventory.objects.at(-1).key), false);
});

test('treats READY as sealed and refuses to repair a missing object', async () => {
  const inventory = createInventory(3);
  const store = new FakeStore();
  for (const object of inventory.objects) store.seed(object);
  store.objects.delete(inventory.objects[1].key);

  await assert.rejects(publishImmutableRelease({ inventory, store }), /sealed release.*missing/);

  assert.equal(
    store.events.some((event) => event.type === 'put-start'),
    false,
  );
});

test('writes only READY when a complete matching manifest barrier already exists', async () => {
  const inventory = createInventory(3);
  const store = new FakeStore();
  for (const object of inventory.objects.slice(0, -1)) store.seed(object);

  const result = await publishImmutableRelease({ inventory, store });

  assert.equal(result.action, 'sealed-existing-manifest');
  assert.equal(result.putCount, 1);
  assert.deepEqual(
    store.events
      .filter((event) => event.type === 'put-start')
      .map((event) => event.object.relativePath),
    ['_READY.json'],
  );
});

test('does not repair payloads behind an existing manifest barrier', async () => {
  const inventory = createInventory(3);
  const store = new FakeStore();
  store.seed(inventory.objects[0]);
  store.seed(inventory.objects.at(-2));

  await assert.rejects(
    publishImmutableRelease({ inventory, store }),
    /manifest but no READY marker.*invalid object set/,
  );
  assert.equal(
    store.events.some((event) => event.type === 'put-start'),
    false,
  );
  assert.equal(store.objects.has(inventory.objects.at(-1).key), false);
});

test('rejects conflicting payload, manifest, metadata, and unexpected objects without overwrite', async () => {
  for (const scenario of ['payload', 'manifest', 'sealed-metadata', 'unexpected']) {
    const inventory = createInventory(2);
    const store = new FakeStore();

    if (scenario === 'payload') {
      store.seed(inventory.objects[0], { bytes: Buffer.from('conflict') });
    } else if (scenario === 'manifest') {
      for (const object of inventory.objects.slice(0, -1)) store.seed(object);
      store.objects.get(inventory.objects.at(-2).key).bytes = Buffer.from('conflict');
    } else if (scenario === 'sealed-metadata') {
      for (const object of inventory.objects) store.seed(object);
      store.objects.get(inventory.objects[0].key).contentType = 'application/octet-stream';
    } else {
      store.seed(inventory.objects[0]);
      store.objects.set(
        `${inventory.prefix}unexpected.txt`,
        createStoredObject(describeObject('x')),
      );
    }

    await assert.rejects(publishImmutableRelease({ inventory, store }), /conflict|unexpected/);
    assert.equal(
      store.events.some((event) => event.type === 'put-start'),
      false,
      scenario,
    );
  }
});

test('never writes manifest or READY when a payload upload fails', async () => {
  const inventory = createInventory(5);
  const failedPayload = inventory.objects[1];
  const store = new FakeStore({ failKeys: [failedPayload.key], putDelay: 4 });

  await assert.rejects(publishImmutableRelease({ inventory, store, concurrency: 3 }), /failed PUT/);

  const attemptedPhases = store.events
    .filter((event) => event.type === 'put-start')
    .map((event) => event.object.phase);
  assert.equal(attemptedPhases.includes('manifest'), false);
  assert.equal(attemptedPhases.includes('ready'), false);
  assert.equal(store.objects.has(inventory.objects.at(-2).key), false);
  assert.equal(store.objects.has(inventory.objects.at(-1).key), false);
});

test('never writes READY when manifest creation or verification fails', async () => {
  for (const mode of ['put-failure', 'stored-conflict']) {
    const inventory = createInventory(2);
    const manifest = inventory.objects.at(-2);
    const store = new FakeStore({
      failKeys: mode === 'put-failure' ? [manifest.key] : [],
      corruptAfterPutKeys: mode === 'stored-conflict' ? [manifest.key] : [],
    });

    await assert.rejects(publishImmutableRelease({ inventory, store }), /failed PUT|conflict/);
    assert.equal(store.objects.has(inventory.objects.at(-1).key), false, mode);
    assert.equal(
      store.events.some((event) => event.type === 'put-start' && event.object.phase === 'ready'),
      false,
      mode,
    );
  }
});

test('validates inventory bytes, ordering, paths, and concurrency before publishing', async () => {
  const inventory = createInventory(1);
  const invalidHash = structuredCloneInventory(inventory);
  invalidHash.objects[0].sha256 = '0'.repeat(64);
  await assert.rejects(
    publishImmutableRelease({ inventory: invalidHash, store: new FakeStore() }),
    /sha256 does not match/,
  );

  const invalidOrder = structuredCloneInventory(inventory);
  [invalidOrder.objects[0], invalidOrder.objects[1]] = [
    invalidOrder.objects[1],
    invalidOrder.objects[0],
  ];
  await assert.rejects(
    publishImmutableRelease({ inventory: invalidOrder, store: new FakeStore() }),
    /invalid phase|release-manifest\.json must be the penultimate/,
  );

  const missingPhase = structuredCloneInventory(inventory);
  missingPhase.objects[0].phase = undefined;
  await assert.rejects(
    publishImmutableRelease({ inventory: missingPhase, store: new FakeStore() }),
    /invalid phase/,
  );

  await assert.rejects(
    publishImmutableRelease({ inventory, store: new FakeStore(), concurrency: 0 }),
    /positive integer/,
  );
});

class FakeStore {
  constructor({
    putDelay = 0,
    failKeys = [],
    corruptAfterPutKeys = [],
    raceKeys = [],
    conflictingRaceKeys = [],
  } = {}) {
    this.objects = new Map();
    this.events = [];
    this.putDelay = putDelay;
    this.failKeys = new Set(failKeys);
    this.corruptAfterPutKeys = new Set(corruptAfterPutKeys);
    this.raceKeys = new Set(raceKeys);
    this.conflictingRaceKeys = new Set(conflictingRaceKeys);
    this.activePuts = 0;
    this.maximumActivePuts = 0;
  }

  seed(object, overrides = {}) {
    const stored = createStoredObject(object);
    Object.assign(stored, overrides);
    if (overrides.bytes) {
      stored.bytes = Buffer.from(overrides.bytes);
      stored.size = stored.bytes.byteLength;
      stored.sha256 = digest(stored.bytes);
    }
    this.objects.set(object.key, stored);
  }

  async list(prefix) {
    this.events.push({ type: 'list', prefix });
    return {
      objects: [...this.objects.keys()]
        .filter((key) => key.startsWith(prefix))
        .sort()
        .map((key) => ({ key })),
    };
  }

  async head(key) {
    this.events.push({ type: 'head', key });
    const object = this.objects.get(key);
    if (!object) return null;
    return {
      size: object.size,
      customMetadata: { sha256: object.sha256 },
      httpMetadata: {
        contentType: object.contentType,
        ...(object.contentEncoding ? { contentEncoding: object.contentEncoding } : {}),
      },
    };
  }

  async getBytes(key) {
    this.events.push({ type: 'get', key });
    const object = this.objects.get(key);
    return object ? Buffer.from(object.bytes) : null;
  }

  async putIfAbsent(object) {
    this.events.push({ type: 'put-start', object });
    this.activePuts += 1;
    this.maximumActivePuts = Math.max(this.maximumActivePuts, this.activePuts);
    try {
      if (this.putDelay > 0) await delay(this.putDelay);
      if (this.failKeys.has(object.key)) throw new Error(`failed PUT ${object.key}`);
      if (this.objects.has(object.key)) return false;
      if (this.raceKeys.has(object.key)) {
        const racedObject = createStoredObject(object);
        if (this.conflictingRaceKeys.has(object.key)) {
          racedObject.bytes = Buffer.from('concurrent-conflict');
          racedObject.size = racedObject.bytes.byteLength;
          racedObject.sha256 = digest(racedObject.bytes);
        }
        this.objects.set(object.key, racedObject);
        return false;
      }
      this.objects.set(object.key, createStoredObject(object));
      if (this.corruptAfterPutKeys.has(object.key)) {
        this.objects.get(object.key).bytes = Buffer.from('corrupt-after-put');
      }
      return true;
    } finally {
      this.activePuts -= 1;
      this.events.push({ type: 'put-end', object });
    }
  }
}

function createInventory(payloadCount) {
  const prefix = `releases/${RELEASE}/`;
  const payload = Array.from({ length: payloadCount }, (_, index) =>
    describeObject(
      `assets/chunk-${index}.js`,
      `export const chunk${index} = ${index};\n`,
      'payload',
    ),
  );
  const manifestBody = `${JSON.stringify({
    schemaVersion: 1,
    release: RELEASE,
    files: payload.map(({ relativePath, size, sha256 }) => ({
      path: relativePath,
      size,
      sha256,
    })),
  })}\n`;
  const manifest = describeObject(MANIFEST_PATH, manifestBody, 'manifest');
  const ready = describeObject(
    READY_PATH,
    `${JSON.stringify({
      schemaVersion: 1,
      release: RELEASE,
      manifest: { path: MANIFEST_PATH, sha256: manifest.sha256 },
      objectCount: payload.length + 2,
    })}\n`,
    'ready',
  );
  return {
    release: RELEASE,
    prefix,
    objects: [...payload, manifest, ready].map((object) => ({
      ...object,
      key: `${prefix}${object.relativePath}`,
    })),
  };
}

const MANIFEST_PATH = 'release-manifest.json';
const READY_PATH = '_READY.json';

function describeObject(relativePath, contents = relativePath, phase = 'payload') {
  const bytes = Buffer.from(contents);
  return {
    key: `releases/${RELEASE}/${relativePath}`,
    relativePath,
    bytes,
    size: bytes.byteLength,
    sha256: digest(bytes),
    contentType: relativePath.endsWith('.json')
      ? 'application/json; charset=utf-8'
      : 'text/javascript; charset=utf-8',
    phase,
  };
}

function createStoredObject(object) {
  return {
    bytes: Buffer.from(object.bytes),
    size: object.size,
    sha256: object.sha256,
    contentType: object.contentType,
    contentEncoding: object.contentEncoding,
  };
}

function structuredCloneInventory(inventory) {
  return {
    ...inventory,
    objects: inventory.objects.map((object) => ({
      ...object,
      bytes: Buffer.from(object.bytes),
    })),
  };
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
