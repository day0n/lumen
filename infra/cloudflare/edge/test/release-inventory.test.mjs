import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { verifyReleaseDirectory } from '../src/release-inventory.mjs';

const RELEASE = '0123456789abcdef0123456789abcdef01234567';
const OTHER_RELEASE = 'abcdef0123456789abcdef0123456789abcdef01';

test('verifies an exact release and returns payload, manifest, then READY upload objects', async (context) => {
  const fixture = await createRelease(context);
  const verified = await verifyReleaseDirectory({
    release: RELEASE,
    releaseDirectory: fixture.releaseDirectory,
  });

  assert.equal(verified.release, RELEASE);
  assert.equal(verified.prefix, `releases/${RELEASE}/`);
  assert.deepEqual(
    verified.objects.map((object) => object.path),
    ['app/index.html', 'assets/app.js', 'assets/app.js.br', 'release-manifest.json', '_READY.json'],
  );
  assert.deepEqual(
    verified.objects.map((object) => object.key),
    verified.objects.map((object) => `releases/${RELEASE}/${object.path}`),
  );
  assert.deepEqual(
    verified.objects.map((object) => object.relativePath),
    verified.objects.map((object) => object.path),
  );
  assert.deepEqual(
    verified.objects.map((object) => object.phase),
    ['payload', 'payload', 'payload', 'manifest', 'ready'],
  );
  assert.ok(verified.objects.every((object) => Buffer.isBuffer(object.bytes)));
  for (const object of verified.objects) {
    assert.equal(object.size, object.bytes.byteLength);
    assert.equal(object.sha256, digest(object.bytes));
    assert.equal(object.contentType, object.metadata.contentType);
    assert.equal(object.contentEncoding, object.metadata.contentEncoding);
  }
  assert.deepEqual(verified.objects[0].metadata, {
    contentType: 'text/html; charset=utf-8',
  });
  assert.deepEqual(verified.objects[2].metadata, {
    contentType: 'text/javascript; charset=utf-8',
    contentEncoding: 'br',
  });
  assert.equal(verified.objects[2].contentEncoding, 'br');
  assert.deepEqual(verified.objects.at(-1).metadata, {
    contentType: 'application/json; charset=utf-8',
  });
});

test('rejects payload bytes that no longer match the manifest digest', async (context) => {
  const fixture = await createRelease(context);
  await writeFile(path.join(fixture.releaseDirectory, 'app', 'index.html'), '<main>bad</main>');

  await assert.rejects(
    verifyReleaseDirectory({ release: RELEASE, releaseDirectory: fixture.releaseDirectory }),
    /object hash does not match manifest: app\/index\.html/,
  );
});

test('rejects local files that are not in the manifest inventory', async (context) => {
  const fixture = await createRelease(context);
  await writeFixtureFile(path.join(fixture.releaseDirectory, 'assets', 'unexpected.js'), 'extra');

  await assert.rejects(
    verifyReleaseDirectory({ release: RELEASE, releaseDirectory: fixture.releaseDirectory }),
    /inventory does not match manifest; extra: assets\/unexpected\.js/,
  );
});

test('binds READY identity, raw manifest bytes, and object count', async (context) => {
  await context.test('READY identity', async (subcontext) => {
    const fixture = await createRelease(subcontext);
    fixture.ready.release = OTHER_RELEASE;
    await writeJson(path.join(fixture.releaseDirectory, '_READY.json'), fixture.ready);

    await assert.rejects(
      verifyReleaseDirectory({ release: RELEASE, releaseDirectory: fixture.releaseDirectory }),
      /readiness marker identity does not match/,
    );
  });

  await context.test('raw manifest hash', async (subcontext) => {
    const fixture = await createRelease(subcontext);
    const manifestPath = path.join(fixture.releaseDirectory, 'release-manifest.json');
    const rawManifest = await readFile(manifestPath);
    await writeFile(manifestPath, Buffer.concat([rawManifest, Buffer.from(' ')]));

    await assert.rejects(
      verifyReleaseDirectory({ release: RELEASE, releaseDirectory: fixture.releaseDirectory }),
      /does not match the raw manifest hash/,
    );
  });

  await context.test('object count', async (subcontext) => {
    const fixture = await createRelease(subcontext);
    fixture.ready.objectCount += 1;
    await writeJson(path.join(fixture.releaseDirectory, '_READY.json'), fixture.ready);

    await assert.rejects(
      verifyReleaseDirectory({ release: RELEASE, releaseDirectory: fixture.releaseDirectory }),
      /object count does not match/,
    );
  });
});

test('requires provenance digests to be strings without coercion', async (context) => {
  const fixture = await createRelease(context);
  fixture.manifest.buildConfigFingerprint = ['a'.repeat(64)];
  fixture.manifest.buildMetadataSha256 = ['b'.repeat(64)];
  fixture.manifest.sourceManifestSha256 = ['c'.repeat(64)];
  await resealManifest(fixture);

  await assert.rejects(
    verifyReleaseDirectory({ release: RELEASE, releaseDirectory: fixture.releaseDirectory }),
    /must be a lowercase SHA-256 digest/,
  );
});

test('requires compressed objects to have exact metadata and an uncompressed sibling', async (context) => {
  await context.test('content encoding', async (subcontext) => {
    const fixture = await createRelease(subcontext);
    fixture.manifest.files.find((entry) => entry.path.endsWith('.br')).contentEncoding = 'gzip';
    await resealManifest(fixture);

    await assert.rejects(
      verifyReleaseDirectory({ release: RELEASE, releaseDirectory: fixture.releaseDirectory }),
      /content encoding is invalid: assets\/app\.js\.br/,
    );
  });

  await context.test('source sibling', async (subcontext) => {
    const fixture = await createRelease(subcontext, [
      {
        path: 'app/index.html',
        bytes: '<main>app</main>',
        contentType: 'text/html; charset=utf-8',
      },
      {
        path: 'assets/app.js.br',
        bytes: Buffer.from([1, 2, 3, 4]),
        contentType: 'text/javascript; charset=utf-8',
        contentEncoding: 'br',
      },
    ]);

    await assert.rejects(
      verifyReleaseDirectory({ release: RELEASE, releaseDirectory: fixture.releaseDirectory }),
      /compressed release object is missing its source sibling/,
    );
  });
});

test('rejects symbolic links and source maps in the local inventory', async (context) => {
  await context.test('symbolic link', async (subcontext) => {
    const fixture = await createRelease(subcontext);
    const externalFile = path.join(fixture.root, 'external.txt');
    await writeFile(externalFile, 'external');
    await symlink(externalFile, path.join(fixture.releaseDirectory, 'linked.txt'));

    await assert.rejects(
      verifyReleaseDirectory({ release: RELEASE, releaseDirectory: fixture.releaseDirectory }),
      /must not contain symbolic links: linked\.txt/,
    );
  });

  await context.test('source map', async (subcontext) => {
    const fixture = await createRelease(subcontext);
    await writeFixtureFile(path.join(fixture.releaseDirectory, 'assets', 'app.js.map'), '{}');

    await assert.rejects(
      verifyReleaseDirectory({ release: RELEASE, releaseDirectory: fixture.releaseDirectory }),
      /unsafe release path: assets\/app\.js\.map/,
    );
  });
});

async function createRelease(context, payload = defaultPayload()) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lumen-release-inventory-'));
  context.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
  });
  const releaseDirectory = path.join(root, RELEASE);
  await mkdir(releaseDirectory, { recursive: true });

  const files = [];
  for (const definition of payload) {
    const bytes = Buffer.from(definition.bytes);
    await writeFixtureFile(path.join(releaseDirectory, ...definition.path.split('/')), bytes);
    files.push({
      path: definition.path,
      size: bytes.byteLength,
      sha256: digest(bytes),
      contentType: definition.contentType,
      ...(definition.contentEncoding ? { contentEncoding: definition.contentEncoding } : {}),
    });
  }
  files.sort((left, right) => left.path.localeCompare(right.path));

  const manifest = {
    schemaVersion: 1,
    release: RELEASE,
    scope: ['app'],
    shells: { app: 'app/index.html' },
    assetBase: `/_static/releases/${RELEASE}/`,
    buildConfigFingerprint: 'a'.repeat(64),
    buildMetadataSha256: 'b'.repeat(64),
    sourceManifestSha256: 'c'.repeat(64),
    files,
  };
  const fixture = { root, releaseDirectory, manifest, ready: null };
  await resealManifest(fixture);
  return fixture;
}

async function resealManifest(fixture) {
  const manifestBytes = await writeJson(
    path.join(fixture.releaseDirectory, 'release-manifest.json'),
    fixture.manifest,
  );
  fixture.ready = {
    schemaVersion: 1,
    release: RELEASE,
    scope: ['app'],
    manifest: {
      path: 'release-manifest.json',
      sha256: digest(manifestBytes),
    },
    objectCount: fixture.manifest.files.length + 2,
  };
  await writeJson(path.join(fixture.releaseDirectory, '_READY.json'), fixture.ready);
}

function defaultPayload() {
  return [
    {
      path: 'app/index.html',
      bytes: '<main>app</main>',
      contentType: 'text/html; charset=utf-8',
    },
    {
      path: 'assets/app.js',
      bytes: 'export const app = true;',
      contentType: 'text/javascript; charset=utf-8',
    },
    {
      path: 'assets/app.js.br',
      bytes: Buffer.from([1, 2, 3, 4]),
      contentType: 'text/javascript; charset=utf-8',
      contentEncoding: 'br',
    },
  ];
}

async function writeFixtureFile(filename, contents) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, contents);
}

async function writeJson(filename, value) {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
  await writeFile(filename, bytes);
  return bytes;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}
