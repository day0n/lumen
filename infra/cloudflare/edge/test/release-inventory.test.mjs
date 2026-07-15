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
  assert.deepEqual(verified.manifest.scope, ['app', 'share', 'landing', 'auth']);
  assert.deepEqual(verified.manifest.shells, {
    app: 'app/index.html',
    share: 'share/index.html',
    landing: 'index.html',
    landingZh: 'zh/index.html',
    auth: 'auth/index.html',
    authZh: 'auth/zh/index.html',
  });
  assert.deepEqual(verified.ready.scope, ['app', 'share', 'landing', 'auth']);
  assert.deepEqual(
    verified.objects.map((object) => object.path),
    [
      'app/index.html',
      'assets/app.js',
      'assets/app.js.br',
      'auth/index.html',
      'auth/zh/index.html',
      'index.html',
      'share/index.html',
      'zh/index.html',
      'release-manifest.json',
      '_READY.json',
    ],
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
    [
      'payload',
      'payload',
      'payload',
      'payload',
      'payload',
      'payload',
      'payload',
      'payload',
      'manifest',
      'ready',
    ],
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
    verifyReleaseDirectory({
      release: RELEASE,
      releaseDirectory: fixture.releaseDirectory,
    }),
    /object hash does not match manifest: app\/index\.html/,
  );
});

test('rejects local files that are not in the manifest inventory', async (context) => {
  const fixture = await createRelease(context);
  await writeFixtureFile(path.join(fixture.releaseDirectory, 'assets', 'unexpected.js'), 'extra');

  await assert.rejects(
    verifyReleaseDirectory({
      release: RELEASE,
      releaseDirectory: fixture.releaseDirectory,
    }),
    /inventory does not match manifest; extra: assets\/unexpected\.js/,
  );
});

test('binds READY identity, raw manifest bytes, and object count', async (context) => {
  await context.test('READY identity', async (subcontext) => {
    const fixture = await createRelease(subcontext);
    fixture.ready.release = OTHER_RELEASE;
    await writeJson(path.join(fixture.releaseDirectory, '_READY.json'), fixture.ready);

    await assert.rejects(
      verifyReleaseDirectory({
        release: RELEASE,
        releaseDirectory: fixture.releaseDirectory,
      }),
      /readiness marker identity does not match/,
    );
  });

  await context.test('raw manifest hash', async (subcontext) => {
    const fixture = await createRelease(subcontext);
    const manifestPath = path.join(fixture.releaseDirectory, 'release-manifest.json');
    const rawManifest = await readFile(manifestPath);
    await writeFile(manifestPath, Buffer.concat([rawManifest, Buffer.from(' ')]));

    await assert.rejects(
      verifyReleaseDirectory({
        release: RELEASE,
        releaseDirectory: fixture.releaseDirectory,
      }),
      /does not match the raw manifest hash/,
    );
  });

  await context.test('object count', async (subcontext) => {
    const fixture = await createRelease(subcontext);
    fixture.ready.objectCount += 1;
    await writeJson(path.join(fixture.releaseDirectory, '_READY.json'), fixture.ready);

    await assert.rejects(
      verifyReleaseDirectory({
        release: RELEASE,
        releaseDirectory: fixture.releaseDirectory,
      }),
      /object count does not match/,
    );
  });
});

test('requires the exact app, share, landing, and auth scope', async (context) => {
  for (const [name, scope] of [
    ['missing share', ['app', 'landing', 'auth']],
    ['missing landing', ['app', 'share', 'auth']],
    ['missing auth', ['app', 'share', 'landing']],
    ['reversed', ['auth', 'landing', 'share', 'app']],
    ['duplicate', ['app', 'share', 'landing', 'auth', 'auth']],
    ['extra', ['app', 'share', 'landing', 'auth', 'not-found']],
  ]) {
    await context.test(`manifest scope ${name}`, async (subcontext) => {
      const fixture = await createRelease(subcontext);
      fixture.manifest.scope = scope;
      await resealManifest(fixture);

      await assert.rejects(
        verifyReleaseDirectory({
          release: RELEASE,
          releaseDirectory: fixture.releaseDirectory,
        }),
        /release manifest scope must be exactly app, share, landing, auth/,
      );
    });
  }

  await context.test('READY still uses the previous scope', async (subcontext) => {
    const fixture = await createRelease(subcontext);
    fixture.ready.scope = ['app', 'share', 'landing'];
    await writeJson(path.join(fixture.releaseDirectory, '_READY.json'), fixture.ready);

    await assert.rejects(
      verifyReleaseDirectory({
        release: RELEASE,
        releaseDirectory: fixture.releaseDirectory,
      }),
      /release readiness marker scope must be exactly app, share, landing, auth/,
    );
  });
});

test('requires exact shell declarations and every declared shell payload', async (context) => {
  for (const shellName of ['share', 'landing', 'landingZh', 'auth', 'authZh']) {
    await context.test(`missing ${shellName} declaration`, async (subcontext) => {
      const fixture = await createRelease(subcontext);
      Reflect.deleteProperty(fixture.manifest.shells, shellName);
      await resealManifest(fixture);

      await assert.rejects(
        verifyReleaseDirectory({
          release: RELEASE,
          releaseDirectory: fixture.releaseDirectory,
        }),
        /release manifest shells has an invalid schema/,
      );
    });
  }

  await context.test('wrong share declaration', async (subcontext) => {
    const fixture = await createRelease(subcontext);
    fixture.manifest.shells.share = 'share/other.html';
    await resealManifest(fixture);

    await assert.rejects(
      verifyReleaseDirectory({
        release: RELEASE,
        releaseDirectory: fixture.releaseDirectory,
      }),
      /release manifest must declare the share shell/,
    );
  });

  await context.test('wrong localized landing declaration', async (subcontext) => {
    const fixture = await createRelease(subcontext);
    fixture.manifest.shells.landingZh = 'landing-zh.html';
    await resealManifest(fixture);

    await assert.rejects(
      verifyReleaseDirectory({
        release: RELEASE,
        releaseDirectory: fixture.releaseDirectory,
      }),
      /release manifest must declare the landingZh shell/,
    );
  });

  await context.test('wrong localized auth declaration', async (subcontext) => {
    const fixture = await createRelease(subcontext);
    fixture.manifest.shells.authZh = 'auth-zh.html';
    await resealManifest(fixture);

    await assert.rejects(
      verifyReleaseDirectory({
        release: RELEASE,
        releaseDirectory: fixture.releaseDirectory,
      }),
      /release manifest must declare the authZh shell/,
    );
  });

  for (const [shellName, shellPath] of [['notFound', '404.html']]) {
    await context.test(`isolates unexpected ${shellName} declaration`, async (subcontext) => {
      const fixture = await createRelease(subcontext);
      fixture.manifest.shells[shellName] = shellPath;
      await resealManifest(fixture);

      await assert.rejects(
        verifyReleaseDirectory({
          release: RELEASE,
          releaseDirectory: fixture.releaseDirectory,
        }),
        /release manifest shells has an invalid schema/,
      );
    });
  }

  for (const [shellName, shellPath] of [
    ['app', 'app/index.html'],
    ['share', 'share/index.html'],
    ['landing', 'index.html'],
    ['landingZh', 'zh/index.html'],
    ['auth', 'auth/index.html'],
    ['authZh', 'auth/zh/index.html'],
  ]) {
    await context.test(`missing ${shellName} payload`, async (subcontext) => {
      const fixture = await createRelease(subcontext);
      fixture.manifest.files = fixture.manifest.files.filter((entry) => entry.path !== shellPath);
      await resealManifest(fixture);

      await assert.rejects(
        verifyReleaseDirectory({
          release: RELEASE,
          releaseDirectory: fixture.releaseDirectory,
        }),
        new RegExp(`release manifest ${shellName} shell is missing from the payload`),
      );
    });
  }
});

test('requires provenance digests to be strings without coercion', async (context) => {
  const fixture = await createRelease(context);
  fixture.manifest.buildConfigFingerprint = ['a'.repeat(64)];
  fixture.manifest.buildMetadataSha256 = ['b'.repeat(64)];
  fixture.manifest.sourceManifestSha256 = ['c'.repeat(64)];
  await resealManifest(fixture);

  await assert.rejects(
    verifyReleaseDirectory({
      release: RELEASE,
      releaseDirectory: fixture.releaseDirectory,
    }),
    /must be a lowercase SHA-256 digest/,
  );
});

test('requires compressed objects to have exact metadata and an uncompressed sibling', async (context) => {
  await context.test('content encoding', async (subcontext) => {
    const fixture = await createRelease(subcontext);
    fixture.manifest.files.find((entry) => entry.path.endsWith('.br')).contentEncoding = 'gzip';
    await resealManifest(fixture);

    await assert.rejects(
      verifyReleaseDirectory({
        release: RELEASE,
        releaseDirectory: fixture.releaseDirectory,
      }),
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
        path: 'share/index.html',
        bytes: '<main>share</main>',
        contentType: 'text/html; charset=utf-8',
      },
      {
        path: 'auth/index.html',
        bytes: '<main>auth</main>',
        contentType: 'text/html; charset=utf-8',
      },
      {
        path: 'auth/zh/index.html',
        bytes: '<main>中文账户</main>',
        contentType: 'text/html; charset=utf-8',
      },
      {
        path: 'index.html',
        bytes: '<main>landing</main>',
        contentType: 'text/html; charset=utf-8',
      },
      {
        path: 'zh/index.html',
        bytes: '<main>中文首页</main>',
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
      verifyReleaseDirectory({
        release: RELEASE,
        releaseDirectory: fixture.releaseDirectory,
      }),
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
      verifyReleaseDirectory({
        release: RELEASE,
        releaseDirectory: fixture.releaseDirectory,
      }),
      /must not contain symbolic links: linked\.txt/,
    );
  });

  await context.test('source map', async (subcontext) => {
    const fixture = await createRelease(subcontext);
    await writeFixtureFile(path.join(fixture.releaseDirectory, 'assets', 'app.js.map'), '{}');

    await assert.rejects(
      verifyReleaseDirectory({
        release: RELEASE,
        releaseDirectory: fixture.releaseDirectory,
      }),
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
    scope: ['app', 'share', 'landing', 'auth'],
    shells: {
      app: 'app/index.html',
      share: 'share/index.html',
      landing: 'index.html',
      landingZh: 'zh/index.html',
      auth: 'auth/index.html',
      authZh: 'auth/zh/index.html',
    },
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
    scope: ['app', 'share', 'landing', 'auth'],
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
    {
      path: 'share/index.html',
      bytes: '<main>share</main>',
      contentType: 'text/html; charset=utf-8',
    },
    {
      path: 'auth/index.html',
      bytes: '<main>auth</main>',
      contentType: 'text/html; charset=utf-8',
    },
    {
      path: 'auth/zh/index.html',
      bytes: '<main>中文账户</main>',
      contentType: 'text/html; charset=utf-8',
    },
    {
      path: 'index.html',
      bytes: '<main>landing</main>',
      contentType: 'text/html; charset=utf-8',
    },
    {
      path: 'zh/index.html',
      bytes: '<main>中文首页</main>',
      contentType: 'text/html; charset=utf-8',
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
