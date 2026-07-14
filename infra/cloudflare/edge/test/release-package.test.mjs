import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { normalizeRelease, packageAppRelease } from '../src/release-package.mjs';
import worker from '../src/worker.mjs';

const RELEASE = '0123456789abcdef0123456789abcdef01234567';

test('packages only manifest assets and approved app public files', async (context) => {
  const fixture = await createFixture(context);
  const first = await packageFixture(fixture, path.join(fixture.root, 'output-a'));
  const second = await packageFixture(fixture, path.join(fixture.root, 'output-b'));

  assert.deepEqual(first.manifest.scope, ['app']);
  assert.deepEqual(first.manifest.shells, { app: 'app/index.html' });
  assert.equal(first.ready.release, RELEASE);
  assert.equal(first.ready.objectCount, first.manifest.files.length + 2);
  assert.equal(first.ready.manifest.sha256.length, 64);

  const outputFiles = first.manifest.files.map((file) => file.path);
  assert.ok(outputFiles.includes('app/index.html'));
  assert.ok(outputFiles.includes('assets/index-abc.js'));
  assert.ok(outputFiles.includes('assets/index-abc.css'));
  assert.ok(outputFiles.includes('home-posters/selected/poster.webp'));
  assert.ok(outputFiles.includes('home-posters/selected/remote.png'));
  assert.ok(outputFiles.includes('home-templates/covers/template.webp'));
  assert.ok(outputFiles.includes('material-showcase/item.webp'));
  assert.ok(outputFiles.includes('particle-masks/sparkle.png'));
  assert.equal(
    first.manifest.files.find((file) => file.path === 'particle-masks/typing.jpg')?.contentType,
    'image/jpeg',
  );
  assert.ok(outputFiles.includes('icon.svg'));
  assert.ok(outputFiles.includes('assets/index-abc.js.br'));
  assert.ok(outputFiles.includes('assets/index-abc.js.gz'));
  assert.equal(
    outputFiles.some((filename) => filename.endsWith('.map')),
    false,
  );
  assert.equal(
    outputFiles.some((filename) => filename.includes('ignored 2')),
    false,
  );
  assert.equal(outputFiles.includes('private.txt'), false);
  assert.deepEqual(outputFiles, [...outputFiles].sort());

  assert.match(
    await readFile(path.join(first.releaseDirectory, 'assets', 'index-abc.js'), 'utf8'),
    /sourceMappingURL=not-a-comment/,
  );

  const shell = await readFile(path.join(first.releaseDirectory, 'app', 'index.html'), 'utf8');
  assert.match(shell, new RegExp(`/_static/releases/${RELEASE}/assets/index-abc\\.js`));
  assert.match(shell, new RegExp(`/_static/releases/${RELEASE}/assets/index-abc\\.css`));
  assert.match(shell, new RegExp(`/_static/releases/${RELEASE}/icon\\.svg`));
  assert.doesNotMatch(shell, /\/app\/assets\//);

  assert.equal(
    await readFile(path.join(first.releaseDirectory, 'release-manifest.json'), 'utf8'),
    await readFile(path.join(second.releaseDirectory, 'release-manifest.json'), 'utf8'),
  );
  assert.equal(
    await readFile(path.join(first.releaseDirectory, '_READY.json'), 'utf8'),
    await readFile(path.join(second.releaseDirectory, '_READY.json'), 'utf8'),
  );
});

test('rejects invalid releases and paths outside the build asset allowlist', async (context) => {
  assert.throws(() => normalizeRelease('latest'), /full 40-character/);

  const fixture = await createFixture(context);
  await writeFile(
    path.join(fixture.distDirectory, '.vite', 'manifest.json'),
    JSON.stringify({ 'index.html': { file: '../private.js', isEntry: true } }),
  );

  await assert.rejects(
    packageFixture(fixture, path.join(fixture.root, 'unsafe-output')),
    /unsafe release path/,
  );
});

test('fails when the built shell references an asset absent from the manifest', async (context) => {
  const fixture = await createFixture(context);
  await writeFile(
    path.join(fixture.distDirectory, 'index.html'),
    `<script type="module" src="/_static/releases/${RELEASE}/assets/missing.js"></script>`,
  );

  await assert.rejects(
    packageFixture(fixture, path.join(fixture.root, 'missing-output')),
    /app shell reference .* is missing/,
  );
});

test('rejects source map comments without rewriting valid JavaScript strings', async (context) => {
  const fixture = await createFixture(context);
  await writeFile(
    path.join(fixture.distDirectory, 'assets', 'index-abc.js'),
    'export const value = 1;\n//# sourceMappingURL=index-abc.js.map\n',
  );

  await assert.rejects(
    packageFixture(fixture, path.join(fixture.root, 'source-map-output')),
    /contains a source map reference/,
  );
});

test('rejects missing manifest imports and unversioned local shell references', async (context) => {
  const missingImportFixture = await createFixture(context);
  const manifestPath = path.join(missingImportFixture.distDirectory, '.vite', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest['index.html'].imports = ['_missing.js'];
  await writeFile(manifestPath, JSON.stringify(manifest));
  await assert.rejects(
    packageFixture(missingImportFixture, path.join(missingImportFixture.root, 'import-output')),
    /references missing imports entry/,
  );

  const missingFileFixture = await createFixture(context);
  const missingFileManifestPath = path.join(
    missingFileFixture.distDirectory,
    '.vite',
    'manifest.json',
  );
  const missingFileManifest = JSON.parse(await readFile(missingFileManifestPath, 'utf8'));
  missingFileManifest['_missing.js'] = { name: 'missing' };
  missingFileManifest['index.html'].imports = ['_missing.js'];
  await writeFile(missingFileManifestPath, JSON.stringify(missingFileManifest));
  await assert.rejects(
    packageFixture(missingFileFixture, path.join(missingFileFixture.root, 'file-output')),
    /entry _missing\.js is missing its file/,
  );

  const unversionedFixture = await createFixture(context);
  await writeFile(
    path.join(unversionedFixture.distDirectory, 'index.html'),
    '<script type="module" src="/unversioned.js"></script>',
  );
  await assert.rejects(
    packageFixture(unversionedFixture, path.join(unversionedFixture.root, 'shell-output')),
    /unversioned local reference/,
  );

  const unquotedFixture = await createFixture(context);
  await writeFile(
    path.join(unquotedFixture.distDirectory, 'index.html'),
    '<img src=/unversioned.png>',
  );
  await assert.rejects(
    packageFixture(unquotedFixture, path.join(unquotedFixture.root, 'unquoted-output')),
    /unquoted URL attribute/,
  );

  const mixedSrcsetFixture = await createFixture(context);
  await writeFile(
    path.join(mixedSrcsetFixture.distDirectory, 'index.html'),
    '<img srcset="data:image/png;base64,abc 1x, /unversioned.png 2x">',
  );
  await assert.rejects(
    packageFixture(mixedSrcsetFixture, path.join(mixedSrcsetFixture.root, 'srcset-output')),
    /ambiguous data URL srcset/,
  );
});

test('binds the staged artifact to matching build metadata', async (context) => {
  const fixture = await createFixture(context);
  const metadataPath = path.join(fixture.distDirectory, '.vite', 'lumen-build.json');
  const metadata = JSON.parse(await readFile(metadataPath, 'utf8'));
  metadata.release = 'abcdef0123456789abcdef0123456789abcdef01';
  await writeFile(metadataPath, JSON.stringify(metadata));

  await assert.rejects(
    packageFixture(fixture, path.join(fixture.root, 'metadata-output')),
    /build metadata does not match/,
  );
});

test('rejects precompressed key collisions and symlinked build directories', async (context) => {
  const collisionFixture = await createFixture(context);
  const manifestPath = path.join(collisionFixture.distDirectory, '.vite', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest['precompressed.js'] = { file: 'assets/index-abc.js.br' };
  await writeFile(manifestPath, JSON.stringify(manifest));
  await writeFile(
    path.join(collisionFixture.distDirectory, 'assets', 'index-abc.js.br'),
    'reserved',
  );
  await assert.rejects(
    packageFixture(collisionFixture, path.join(collisionFixture.root, 'collision-output')),
    /reserve a generated compression key/,
  );

  const symlinkFixture = await createFixture(context);
  const externalAssets = path.join(symlinkFixture.root, 'external-assets');
  await mkdir(externalAssets, { recursive: true });
  await Promise.all([
    writeFile(path.join(externalAssets, 'index-abc.js'), 'export const value = 1;'),
    writeFile(path.join(externalAssets, 'index-abc.css'), '.root{}'),
  ]);
  await rm(path.join(symlinkFixture.distDirectory, 'assets'), { recursive: true, force: true });
  await symlink(externalAssets, path.join(symlinkFixture.distDirectory, 'assets'), 'dir');
  await assert.rejects(
    packageFixture(symlinkFixture, path.join(symlinkFixture.root, 'symlink-output')),
    /contains a symbolic link/,
  );
});

test('rejects a symbolic-link output root before removing a release target', async (context) => {
  const fixture = await createFixture(context);
  const externalOutput = path.join(fixture.root, 'external-output');
  const linkedOutput = path.join(fixture.root, 'linked-output');
  await mkdir(externalOutput);
  await symlink(externalOutput, linkedOutput);

  await assert.rejects(
    packageFixture(fixture, linkedOutput),
    /release output root is missing or unsafe/,
  );
});

test('serves every packaged shell reference through the edge worker', async (context) => {
  const fixture = await createFixture(context);
  const packaged = await packageFixture(fixture, path.join(fixture.root, 'worker-output'));
  const bucket = {
    async get(key) {
      const prefix = `releases/${RELEASE}/`;
      if (!key.startsWith(prefix)) return null;
      const relativePath = key.slice(prefix.length);
      const bytes = await readFile(
        path.join(packaged.releaseDirectory, ...relativePath.split('/')),
      ).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      if (!bytes) return null;
      return {
        body: bytes,
        httpEtag: `"${relativePath}"`,
        size: bytes.byteLength,
        writeHttpMetadata() {},
      };
    },
  };
  const environment = { ACTIVE_FRONTEND_RELEASE: RELEASE, FRONTEND_BUCKET: bucket };
  const executionContext = { waitUntil() {} };

  const shellResponse = await worker.fetch(
    new Request('https://lumenstudio.tech/app/dashboard'),
    environment,
    executionContext,
  );
  assert.equal(shellResponse.status, 200);
  assert.equal(shellResponse.headers.get('x-lumen-release'), RELEASE);
  const shell = await shellResponse.text();
  const references = [...shell.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)]
    .map((match) => match[1])
    .filter((reference) => reference.startsWith('/_static/releases/'));
  assert.ok(references.length >= 3);

  for (const reference of references) {
    const response = await worker.fetch(
      new Request(`https://lumenstudio.tech${reference}`),
      environment,
      executionContext,
    );
    assert.equal(response.status, 200, reference);
    assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  }

  const posterResponse = await worker.fetch(
    new Request('https://lumenstudio.tech/app/home-posters/selected/poster.webp'),
    environment,
    executionContext,
  );
  assert.equal(posterResponse.status, 200);
  assert.equal(posterResponse.headers.get('content-type'), 'image/webp');
});

async function createFixture(context) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'lumen-frontend-release-'));
  context.after(async () => {
    const { rm } = await import('node:fs/promises');
    await rm(root, { recursive: true, force: true });
  });

  const distDirectory = path.join(root, 'dist');
  const appPublicDirectory = path.join(root, 'app-public');
  const studioPublicDirectory = path.join(root, 'studio-public');
  const iconFile = path.join(root, 'icon.svg');

  await Promise.all([
    writeFixtureFile(
      path.join(distDirectory, 'assets', 'index-abc.js'),
      `export const marker = "//# sourceMappingURL=not-a-comment";\nexport const message = '${'versioned-javascript-'.repeat(200)}';\n`,
    ),
    writeFixtureFile(
      path.join(distDirectory, 'assets', 'index-abc.css'),
      `.root{color:#fff;background:${'#101010 '.repeat(200)}}\n`,
    ),
    writeFixtureFile(path.join(distDirectory, 'assets', 'index-abc.js.map'), '{}'),
    writeFixtureFile(path.join(distDirectory, 'assets', 'ignored 2.js'), 'ignored'),
    writeFixtureFile(
      path.join(appPublicDirectory, 'home-posters', 'selected', 'poster.webp'),
      'poster',
    ),
    writeFixtureFile(path.join(appPublicDirectory, 'private.txt'), 'not-approved'),
    writeFixtureFile(
      path.join(studioPublicDirectory, 'home-posters', 'selected', 'remote.png'),
      'remote-poster',
    ),
    writeFixtureFile(
      path.join(studioPublicDirectory, 'home-templates', 'covers', 'template.webp'),
      'template',
    ),
    writeFixtureFile(
      path.join(studioPublicDirectory, 'material-showcase', 'item.webp'),
      'showcase',
    ),
    writeFixtureFile(path.join(studioPublicDirectory, 'particle-masks', 'sparkle.png'), 'mask'),
    writeFixtureFile(path.join(studioPublicDirectory, 'particle-masks', 'typing.jpg'), 'photo'),
    writeFixtureFile(iconFile, '<svg xmlns="http://www.w3.org/2000/svg"></svg>'),
  ]);
  await writeFixtureFile(
    path.join(distDirectory, '.vite', 'manifest.json'),
    JSON.stringify({
      'index.html': {
        file: 'assets/index-abc.js',
        css: ['assets/index-abc.css'],
        isEntry: true,
      },
    }),
  );
  await writeFixtureFile(
    path.join(distDirectory, '.vite', 'lumen-build.json'),
    JSON.stringify({
      schemaVersion: 1,
      release: RELEASE,
      assetBase: `/_static/releases/${RELEASE}/`,
      buildConfigFingerprint: 'a'.repeat(64),
    }),
  );
  await writeFixtureFile(
    path.join(distDirectory, 'index.html'),
    [
      '<!doctype html>',
      `<link rel="icon" href="/_static/releases/${RELEASE}/icon.svg">`,
      `<link rel="stylesheet" href="/_static/releases/${RELEASE}/assets/index-abc.css">`,
      `<script type="module" src="/_static/releases/${RELEASE}/assets/index-abc.js"></script>`,
    ].join('\n'),
  );

  return {
    root,
    distDirectory,
    appPublicDirectory,
    studioPublicDirectory,
    iconFile,
  };
}

async function packageFixture(fixture, outputRoot) {
  return packageAppRelease({
    release: RELEASE,
    distDirectory: fixture.distDirectory,
    appPublicDirectory: fixture.appPublicDirectory,
    studioPublicDirectory: fixture.studioPublicDirectory,
    iconFile: fixture.iconFile,
    outputRoot,
  });
}

async function writeFixtureFile(filename, contents) {
  await mkdir(path.dirname(filename), { recursive: true });
  await writeFile(filename, contents);
}
