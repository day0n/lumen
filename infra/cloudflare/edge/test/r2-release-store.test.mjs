import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { createR2ReleaseStore } from '../src/r2-release-store.mjs';

const RELEASE = '0123456789abcdef0123456789abcdef01234567';
const PREFIX = `releases/${RELEASE}/`;
const SETTINGS = {
  accountId: 'account-id',
  bucket: 'frontend-releases',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
};

test('list reads every page and returns a sorted, complete inventory', async () => {
  const client = new FakeClient((command) => {
    assert.equal(command.name, 'listObjectsV2');
    if (!command.input.ContinuationToken) {
      return {
        Contents: [{ Key: `${PREFIX}z.js` }, { Key: `${PREFIX}a.js` }],
        IsTruncated: true,
        NextContinuationToken: 'next-page',
      };
    }
    assert.equal(command.input.ContinuationToken, 'next-page');
    return { Contents: [{ Key: `${PREFIX}m.js` }], IsTruncated: false };
  });
  const store = createStore(client);

  const result = await store.list(PREFIX);

  assert.deepEqual(result, {
    objects: [{ key: `${PREFIX}a.js` }, { key: `${PREFIX}m.js` }, { key: `${PREFIX}z.js` }],
  });
  assert.deepEqual(
    client.calls.map((command) => command.input),
    [
      { Bucket: SETTINGS.bucket, Prefix: PREFIX },
      { Bucket: SETTINGS.bucket, Prefix: PREFIX, ContinuationToken: 'next-page' },
    ],
  );
});

test('list rejects broken pagination instead of returning a partial inventory', async () => {
  const client = new FakeClient(() => ({ IsTruncated: true }));
  const store = createStore(client);

  await assert.rejects(store.list(PREFIX), /invalid continuation token/);
});

test('head maps object metadata and returns null for a missing key', async () => {
  const object = describeObject('assets/app.js.gz', 'compressed', 'gzip');
  const client = new FakeClient((command) => {
    if (command.input.Key.endsWith('missing.js')) throw httpError(404, 'NotFound');
    return {
      ContentLength: object.size,
      ContentType: object.contentType,
      ContentEncoding: object.contentEncoding,
      Metadata: { SHA256: object.sha256, Release: RELEASE },
    };
  });
  const store = createStore(client);

  assert.deepEqual(await store.head(object.key), {
    size: object.size,
    sha256: object.sha256,
    release: RELEASE,
    customMetadata: { sha256: object.sha256, release: RELEASE },
    contentType: object.contentType,
    contentEncoding: 'gzip',
  });
  assert.equal(await store.head(`${PREFIX}missing.js`), null);
  assert.deepEqual(client.calls[0].input, { Bucket: SETTINGS.bucket, Key: object.key });
});

test('getBytes collects the complete streamed body and returns null for a missing key', async () => {
  const key = `${PREFIX}assets/app.js`;
  const client = new FakeClient((command) => {
    if (command.input.Key.endsWith('missing.js')) throw httpError(404, 'NoSuchKey');
    return {
      Body: (async function* body() {
        yield Buffer.from('complete ');
        yield new Uint8Array(Buffer.from('body'));
      })(),
    };
  });
  const store = createStore(client);

  assert.equal((await store.getBytes(key)).toString(), 'complete body');
  assert.equal(await store.getBytes(`${PREFIX}missing.js`), null);
});

test('putIfAbsent sends an immutable conditional write with checksums and release metadata', async () => {
  const object = describeObject('assets/app.js.gz', 'compressed bytes', 'gzip');
  const client = new FakeClient(() => ({}));
  const store = createStore(client);

  assert.equal(await store.putIfAbsent(object), true);

  assert.equal(client.calls.length, 1);
  assert.equal(client.calls[0].name, 'putObject');
  assert.deepEqual(client.calls[0].input, {
    Bucket: SETTINGS.bucket,
    Key: object.key,
    Body: object.bytes,
    IfNoneMatch: '*',
    ContentLength: object.size,
    ContentType: object.contentType,
    ContentEncoding: 'gzip',
    Metadata: { sha256: object.sha256, release: RELEASE },
    ContentMD5: createHash('md5').update(object.bytes).digest('base64'),
  });
});

test('putIfAbsent accepts the immutable release claim namespace', async () => {
  const bytes = Buffer.from('{"claim":true}\n');
  const object = {
    key: `release-claims/${RELEASE}.json`,
    relativePath: `release-claims/${RELEASE}.json`,
    bytes,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    contentType: 'application/json; charset=utf-8',
    phase: 'claim',
  };
  const client = new FakeClient(() => ({}));

  assert.equal(await createStore(client).putIfAbsent(object), true);
  assert.equal(client.calls[0].input.Key, object.key);
  assert.equal(client.calls[0].input.Metadata.release, RELEASE);
});

test('putIfAbsent accepts a 412 race only when bytes and metadata are identical', async () => {
  const object = describeObject('assets/app.js', 'same bytes');
  const client = new FakeClient((command) => {
    if (command.name === 'putObject') throw httpError(412, 'PreconditionFailed');
    if (command.name === 'headObject') return headResponse(object);
    if (command.name === 'getObject') {
      return { Body: { transformToByteArray: async () => new Uint8Array(object.bytes) } };
    }
    throw new Error(`unexpected command: ${command.name}`);
  });
  const store = createStore(client);

  assert.equal(await store.putIfAbsent(object), false);
  assert.deepEqual(
    client.calls.map((command) => command.name),
    ['putObject', 'headObject', 'getObject'],
  );
});

test('putIfAbsent rejects 409 and 412 races with conflicting bytes or metadata', async (t) => {
  const object = describeObject('assets/app.js', 'expected bytes');

  await t.test('conflicting bytes', async () => {
    const client = raceClient(object, {
      status: 409,
      body: Buffer.from('conflicting bytes'),
    });
    await assert.rejects(createStore(client).putIfAbsent(object), /conflicts with existing data/);
  });

  await t.test('conflicting HTTP metadata', async () => {
    const client = raceClient(object, {
      status: 412,
      head: { ...headResponse(object), ContentType: 'application/octet-stream' },
    });
    await assert.rejects(createStore(client).putIfAbsent(object), /conflicts with existing data/);
  });

  await t.test('extra custom metadata', async () => {
    const client = raceClient(object, {
      status: 412,
      head: {
        ...headResponse(object),
        Metadata: { sha256: object.sha256, release: RELEASE, mutable: 'true' },
      },
    });
    await assert.rejects(createStore(client).putIfAbsent(object), /conflicts with existing data/);
  });
});

test('putIfAbsent propagates non-conditional failures without reading the object', async () => {
  const object = describeObject('assets/app.js', 'body');
  const failure = httpError(500, 'InternalError');
  const client = new FakeClient(() => {
    throw failure;
  });

  await assert.rejects(createStore(client).putIfAbsent(object), (error) => error === failure);
  assert.equal(client.calls.length, 1);
});

test('putIfAbsent validates bytes and release identity before sending', async () => {
  const object = describeObject('assets/app.js', 'body');
  const client = new FakeClient(() => ({}));
  const store = createStore(client);

  await assert.rejects(
    store.putIfAbsent({ ...object, sha256: '0'.repeat(64) }),
    /sha256 does not match bytes/,
  );
  await assert.rejects(
    store.putIfAbsent({ ...object, key: 'releases/latest/assets/app.js' }),
    /full release SHA/,
  );
  assert.equal(client.calls.length, 0);
});

function createStore(client) {
  return createR2ReleaseStore({
    ...SETTINGS,
    client,
    commandFactory: (name, input) => ({ name, input }),
  });
}

class FakeClient {
  constructor(handler) {
    this.handler = handler;
    this.calls = [];
  }

  async send(command) {
    this.calls.push(command);
    return this.handler(command);
  }
}

function raceClient(object, { status, head = headResponse(object), body = object.bytes }) {
  return new FakeClient((command) => {
    if (command.name === 'putObject') throw httpError(status, 'ConditionalRequestConflict');
    if (command.name === 'headObject') return head;
    if (command.name === 'getObject') return { Body: body };
    throw new Error(`unexpected command: ${command.name}`);
  });
}

function describeObject(relativePath, contents, contentEncoding) {
  const bytes = Buffer.from(contents);
  return {
    key: `${PREFIX}${relativePath}`,
    relativePath,
    bytes,
    size: bytes.byteLength,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    contentType: 'text/javascript; charset=utf-8',
    ...(contentEncoding ? { contentEncoding } : {}),
    phase: 'payload',
  };
}

function headResponse(object) {
  return {
    ContentLength: object.size,
    ContentType: object.contentType,
    ...(object.contentEncoding ? { ContentEncoding: object.contentEncoding } : {}),
    Metadata: { sha256: object.sha256, release: RELEASE },
  };
}

function httpError(status, name) {
  const error = new Error(name);
  error.name = name;
  error.$metadata = { httpStatusCode: status };
  return error;
}
