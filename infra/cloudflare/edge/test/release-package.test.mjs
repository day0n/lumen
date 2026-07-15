import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { normalizeRelease, packageAppRelease } from '../src/release-package.mjs';
import worker from '../src/worker.mjs';

const RELEASE = '0123456789abcdef0123456789abcdef01234567';

test('packages and verifies every localized frontend shell', async (context) => {
  const fixture = await createFixture(context);
  const first = await packageFixture(fixture, path.join(fixture.root, 'output-a'));
  const second = await packageFixture(fixture, path.join(fixture.root, 'output-b'));

  assert.deepEqual(first.manifest.scope, ['app', 'share', 'landing', 'auth', 'not-found']);
  assert.deepEqual(first.manifest.shells, {
    app: 'app/index.html',
    share: 'share/index.html',
    landing: 'index.html',
    landingZh: 'zh/index.html',
    auth: 'auth/index.html',
    authZh: 'auth/zh/index.html',
    notFound: '404.html',
    notFoundZh: 'zh/404.html',
  });
  assert.deepEqual(first.ready.scope, ['app', 'share', 'landing', 'auth', 'not-found']);
  assert.equal(first.ready.release, RELEASE);
  assert.equal(first.ready.objectCount, first.manifest.files.length + 2);
  assert.equal(first.ready.manifest.sha256.length, 64);

  const outputFiles = first.manifest.files.map((file) => file.path);
  assert.ok(outputFiles.includes('app/index.html'));
  assert.ok(outputFiles.includes('share/index.html'));
  assert.ok(outputFiles.includes('index.html'));
  assert.ok(outputFiles.includes('zh/index.html'));
  assert.ok(outputFiles.includes('auth/index.html'));
  assert.ok(outputFiles.includes('auth/zh/index.html'));
  assert.ok(outputFiles.includes('404.html'));
  assert.ok(outputFiles.includes('zh/404.html'));
  assert.ok(outputFiles.includes('assets/index-abc.js'));
  assert.ok(outputFiles.includes('assets/index-abc.css'));
  assert.ok(outputFiles.includes('assets/share-abc.js'));
  assert.ok(outputFiles.includes('assets/share-abc.css'));
  assert.ok(outputFiles.includes('assets/landing-abc.js'));
  assert.ok(outputFiles.includes('assets/landing-abc.css'));
  assert.ok(outputFiles.includes('assets/landing-zh-abc.js'));
  assert.ok(outputFiles.includes('assets/landing-zh-abc.css'));
  assert.ok(outputFiles.includes('assets/auth-abc.js'));
  assert.ok(outputFiles.includes('assets/auth-abc.css'));
  assert.ok(outputFiles.includes('assets/auth-zh-abc.js'));
  assert.ok(outputFiles.includes('assets/auth-zh-abc.css'));
  assert.ok(outputFiles.includes('assets/not-found-abc.js'));
  assert.ok(outputFiles.includes('assets/not-found-abc.css'));
  assert.ok(outputFiles.includes('assets/not-found-zh-abc.js'));
  assert.ok(outputFiles.includes('assets/not-found-zh-abc.css'));
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

  const shareShell = await readFile(
    path.join(first.releaseDirectory, 'share', 'index.html'),
    'utf8',
  );
  assert.match(shareShell, new RegExp(`/_static/releases/${RELEASE}/assets/share-abc\\.js`));
  assert.match(shareShell, new RegExp(`/_static/releases/${RELEASE}/assets/share-abc\\.css`));
  assert.match(shareShell, new RegExp(`/_static/releases/${RELEASE}/icon\\.svg`));

  const authShell = await readFile(path.join(first.releaseDirectory, 'auth', 'index.html'), 'utf8');
  assert.match(authShell, /<html lang="en">/);
  assert.match(authShell, /<title>Account — Lumen<\/title>/);
  assert.match(authShell, /name="robots" content="noindex, nofollow"/);
  assert.match(authShell, /data-lumen-static-auth="en"/);
  assert.match(authShell, /auth-loading/);
  assert.match(authShell, new RegExp(`/_static/releases/${RELEASE}/assets/auth-abc\\.js`));
  assert.match(authShell, new RegExp(`/_static/releases/${RELEASE}/assets/auth-abc\\.css`));

  const authZhShell = await readFile(
    path.join(first.releaseDirectory, 'auth', 'zh', 'index.html'),
    'utf8',
  );
  assert.match(authZhShell, /<html lang="zh-CN">/);
  assert.match(authZhShell, /<title>账户 — Lumen<\/title>/);
  assert.match(authZhShell, /name="robots" content="noindex, nofollow"/);
  assert.match(authZhShell, /data-lumen-static-auth="zh"/);
  assert.match(authZhShell, /auth-loading/);
  assert.match(authZhShell, new RegExp(`/_static/releases/${RELEASE}/assets/auth-zh-abc\\.js`));
  assert.match(authZhShell, new RegExp(`/_static/releases/${RELEASE}/assets/auth-zh-abc\\.css`));

  const notFoundShell = await readFile(path.join(first.releaseDirectory, '404.html'), 'utf8');
  assert.match(notFoundShell, /<html lang="en">/);
  assert.match(notFoundShell, /<title>Page not found — Lumen<\/title>/);
  assert.match(notFoundShell, /name="robots" content="noindex, nofollow"/);
  assert.match(notFoundShell, /data-lumen-static-not-found="en"/);
  assert.match(notFoundShell, /not-found-content/);
  assert.match(notFoundShell, new RegExp(`/_static/releases/${RELEASE}/assets/not-found-abc\\.js`));
  assert.match(
    notFoundShell,
    new RegExp(`/_static/releases/${RELEASE}/assets/not-found-abc\\.css`),
  );

  const notFoundZhShell = await readFile(
    path.join(first.releaseDirectory, 'zh', '404.html'),
    'utf8',
  );
  assert.match(notFoundZhShell, /<html lang="zh-CN">/);
  assert.match(notFoundZhShell, /<title>页面不存在 — Lumen<\/title>/);
  assert.match(notFoundZhShell, /name="robots" content="noindex, nofollow"/);
  assert.match(notFoundZhShell, /data-lumen-static-not-found="zh"/);
  assert.match(notFoundZhShell, /not-found-content/);
  assert.match(
    notFoundZhShell,
    new RegExp(`/_static/releases/${RELEASE}/assets/not-found-zh-abc\\.js`),
  );
  assert.match(
    notFoundZhShell,
    new RegExp(`/_static/releases/${RELEASE}/assets/not-found-zh-abc\\.css`),
  );

  const landingShell = await readFile(path.join(first.releaseDirectory, 'index.html'), 'utf8');
  assert.match(landingShell, /<html lang="en">/);
  assert.match(landingShell, /<title>Lumen — Turn products into videos that sell<\/title>/);
  assert.match(landingShell, /data-lumen-prerendered="true"/);
  assert.match(landingShell, /data-lumen-static-landing="en"/);
  assert.match(landingShell, new RegExp(`/_static/releases/${RELEASE}/assets/landing-abc\\.js`));
  assert.match(landingShell, new RegExp(`/_static/releases/${RELEASE}/assets/landing-abc\\.css`));

  const landingZhShell = await readFile(
    path.join(first.releaseDirectory, 'zh', 'index.html'),
    'utf8',
  );
  assert.match(landingZhShell, /<html lang="zh-CN">/);
  assert.match(landingZhShell, /<title>Lumen — 把商品变成爆款带货视频<\/title>/);
  assert.match(landingZhShell, /data-lumen-prerendered="true"/);
  assert.match(landingZhShell, /data-lumen-static-landing="zh"/);
  assert.match(
    landingZhShell,
    new RegExp(`/_static/releases/${RELEASE}/assets/landing-zh-abc\\.js`),
  );
  assert.match(
    landingZhShell,
    new RegExp(`/_static/releases/${RELEASE}/assets/landing-zh-abc\\.css`),
  );

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
  const manifestPath = path.join(fixture.distDirectory, '.vite', 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  manifest['index.html'].file = '../private.js';
  await writeFile(manifestPath, JSON.stringify(manifest));

  await assert.rejects(
    packageFixture(fixture, path.join(fixture.root, 'unsafe-output')),
    /unsafe release path/,
  );
});

test('requires exactly the declared frontend Vite page entries', async (context) => {
  await context.test('missing share entry', async (subcontext) => {
    const fixture = await createFixture(subcontext);
    const manifestPath = path.join(fixture.distDirectory, '.vite', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    Reflect.deleteProperty(manifest, 'share.html');
    await writeFile(manifestPath, JSON.stringify(manifest));

    await assert.rejects(
      packageFixture(fixture, path.join(fixture.root, 'missing-share-entry-output')),
      /missing the share\.html entry/,
    );
  });

  await context.test('share entry is not a page entry', async (subcontext) => {
    const fixture = await createFixture(subcontext);
    const manifestPath = path.join(fixture.distDirectory, '.vite', 'manifest.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest['share.html'].isEntry = false;
    await writeFile(manifestPath, JSON.stringify(manifest));

    await assert.rejects(
      packageFixture(fixture, path.join(fixture.root, 'inactive-share-entry-output')),
      /missing the share\.html entry/,
    );
  });

  for (const entryName of [
    'auth.html',
    'auth-zh.html',
    'landing.html',
    'landing-zh.html',
    'not-found.html',
    'not-found-zh.html',
  ]) {
    await context.test(`missing ${entryName} entry`, async (subcontext) => {
      const fixture = await createFixture(subcontext);
      const manifestPath = path.join(fixture.distDirectory, '.vite', 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      Reflect.deleteProperty(manifest, entryName);
      await writeFile(manifestPath, JSON.stringify(manifest));

      await assert.rejects(
        packageFixture(fixture, path.join(fixture.root, `missing-${entryName}-entry-output`)),
        new RegExp(`missing the ${entryName.replace('.', '\\.')} entry`),
      );
    });
  }

  for (const unexpectedEntry of ['404.html']) {
    await context.test(`isolates unexpected ${unexpectedEntry} entry`, async (subcontext) => {
      const fixture = await createFixture(subcontext);
      const manifestPath = path.join(fixture.distDirectory, '.vite', 'manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      manifest[unexpectedEntry] = {
        file: 'assets/index-abc.js',
        isEntry: true,
      };
      await writeFile(manifestPath, JSON.stringify(manifest));

      await assert.rejects(
        packageFixture(
          fixture,
          path.join(fixture.root, `unexpected-${unexpectedEntry}-entry-output`),
        ),
        /entry set must be exactly auth-zh\.html, auth\.html, index\.html, landing-zh\.html, landing\.html, not-found-zh\.html, not-found\.html, share\.html/,
      );
    });
  }
});

test('requires every built release shell to exist as a regular build file', async (context) => {
  for (const [shellName, entryName] of [
    ['share', 'share.html'],
    ['auth', 'auth.html'],
    ['authZh', 'auth-zh.html'],
    ['landing', 'landing.html'],
    ['landingZh', 'landing-zh.html'],
    ['notFound', 'not-found.html'],
    ['notFoundZh', 'not-found-zh.html'],
  ]) {
    await context.test(`missing ${shellName} shell`, async (subcontext) => {
      const fixture = await createFixture(subcontext);
      await rm(path.join(fixture.distDirectory, entryName));

      await assert.rejects(
        packageFixture(fixture, path.join(fixture.root, `missing-${shellName}-shell-output`)),
        new RegExp(`built ${shellName} shell is missing`),
      );
    });
  }
});

test('validates the share shell against its own entry and immutable allowlist', async (context) => {
  await context.test('unversioned reference', async (subcontext) => {
    const fixture = await createFixture(subcontext);
    await writeFile(
      path.join(fixture.distDirectory, 'share.html'),
      '<script type="module" src="/unversioned-share.js"></script>',
    );

    await assert.rejects(
      packageFixture(fixture, path.join(fixture.root, 'unversioned-share-output')),
      /share shell contains an unversioned local reference/,
    );
  });

  await context.test('app entry cannot stand in for the share entry', async (subcontext) => {
    const fixture = await createFixture(subcontext);
    await writeFile(
      path.join(fixture.distDirectory, 'share.html'),
      [
        `<link rel="icon" href="/_static/releases/${RELEASE}/icon.svg">`,
        `<link rel="stylesheet" href="/_static/releases/${RELEASE}/assets/index-abc.css">`,
        `<script type="module" src="/_static/releases/${RELEASE}/assets/index-abc.js"></script>`,
      ].join('\n'),
    );

    await assert.rejects(
      packageFixture(fixture, path.join(fixture.root, 'wrong-share-entry-output')),
      /share shell does not reference required entry asset: assets\/share-abc\.js/,
    );
  });

  await context.test('reference outside the immutable asset allowlist', async (subcontext) => {
    const fixture = await createFixture(subcontext);
    await writeFile(
      path.join(fixture.distDirectory, 'share.html'),
      [
        `<link rel="stylesheet" href="/_static/releases/${RELEASE}/assets/share-abc.css">`,
        `<script type="module" src="/_static/releases/${RELEASE}/assets/share-abc.js"></script>`,
        `<link rel="preload" href="/_static/releases/${RELEASE}/share/index.html">`,
      ].join('\n'),
    );

    await assert.rejects(
      packageFixture(fixture, path.join(fixture.root, 'share-allowlist-output')),
      /share shell reference is outside the edge asset allowlist/,
    );
  });
});

test('validates each localized landing shell against its own Vite entry', async (context) => {
  for (const definition of [
    {
      shellName: 'landing',
      entryName: 'landing.html',
      otherScript: 'assets/share-abc.js',
      otherStyle: 'assets/share-abc.css',
      requiredScript: 'assets/landing-abc.js',
    },
    {
      shellName: 'landingZh',
      entryName: 'landing-zh.html',
      otherScript: 'assets/landing-abc.js',
      otherStyle: 'assets/landing-abc.css',
      requiredScript: 'assets/landing-zh-abc.js',
    },
  ]) {
    await context.test(`${definition.shellName} cannot use another entry`, async (subcontext) => {
      const fixture = await createFixture(subcontext);
      await writeFile(
        path.join(fixture.distDirectory, definition.entryName),
        [
          `<link rel="icon" href="/_static/releases/${RELEASE}/icon.svg">`,
          `<link rel="stylesheet" href="/_static/releases/${RELEASE}/${definition.otherStyle}">`,
          `<script type="module" src="/_static/releases/${RELEASE}/${definition.otherScript}"></script>`,
        ].join('\n'),
      );

      await assert.rejects(
        packageFixture(
          fixture,
          path.join(fixture.root, `wrong-${definition.shellName}-entry-output`),
        ),
        new RegExp(
          `${definition.shellName} shell does not reference required entry asset: ${definition.requiredScript.replace('.', '\\.')}`,
        ),
      );
    });
  }
});

test('validates each localized auth shell against its own Vite entry', async (context) => {
  for (const definition of [
    {
      shellName: 'auth',
      entryName: 'auth.html',
      otherScript: 'assets/share-abc.js',
      otherStyle: 'assets/share-abc.css',
      requiredScript: 'assets/auth-abc.js',
    },
    {
      shellName: 'authZh',
      entryName: 'auth-zh.html',
      otherScript: 'assets/auth-abc.js',
      otherStyle: 'assets/auth-abc.css',
      requiredScript: 'assets/auth-zh-abc.js',
    },
  ]) {
    await context.test(`${definition.shellName} cannot use another entry`, async (subcontext) => {
      const fixture = await createFixture(subcontext);
      await writeFile(
        path.join(fixture.distDirectory, definition.entryName),
        [
          `<link rel="icon" href="/_static/releases/${RELEASE}/icon.svg">`,
          `<link rel="stylesheet" href="/_static/releases/${RELEASE}/${definition.otherStyle}">`,
          `<script type="module" src="/_static/releases/${RELEASE}/${definition.otherScript}"></script>`,
        ].join('\n'),
      );

      await assert.rejects(
        packageFixture(
          fixture,
          path.join(fixture.root, `wrong-${definition.shellName}-entry-output`),
        ),
        new RegExp(
          `${definition.shellName} shell does not reference required entry asset: ${definition.requiredScript.replace('.', '\\.')}`,
        ),
      );
    });
  }
});

test('validates each localized not-found shell against its own Vite entry', async (context) => {
  for (const definition of [
    {
      shellName: 'notFound',
      entryName: 'not-found.html',
      otherScript: 'assets/share-abc.js',
      otherStyle: 'assets/share-abc.css',
      requiredScript: 'assets/not-found-abc.js',
    },
    {
      shellName: 'notFoundZh',
      entryName: 'not-found-zh.html',
      otherScript: 'assets/not-found-abc.js',
      otherStyle: 'assets/not-found-abc.css',
      requiredScript: 'assets/not-found-zh-abc.js',
    },
  ]) {
    await context.test(`${definition.shellName} cannot use another entry`, async (subcontext) => {
      const fixture = await createFixture(subcontext);
      await writeFile(
        path.join(fixture.distDirectory, definition.entryName),
        [
          `<link rel="icon" href="/_static/releases/${RELEASE}/icon.svg">`,
          `<link rel="stylesheet" href="/_static/releases/${RELEASE}/${definition.otherStyle}">`,
          `<script type="module" src="/_static/releases/${RELEASE}/${definition.otherScript}"></script>`,
        ].join('\n'),
      );

      await assert.rejects(
        packageFixture(
          fixture,
          path.join(fixture.root, `wrong-${definition.shellName}-entry-output`),
        ),
        new RegExp(
          `${definition.shellName} shell does not reference required entry asset: ${definition.requiredScript.replace('.', '\\.')}`,
        ),
      );
    });
  }
});

test('rejects additive assets from another page entry', async (context) => {
  for (const definition of [
    {
      name: 'release-relative entry',
      source: `/_static/releases/${RELEASE}/assets/share-abc.js`,
      error: /landing shell references an asset outside its entry closure: assets\/share-abc\.js/,
    },
    {
      name: 'absolute entry',
      source: `https://lumenstudio.tech/_static/releases/${RELEASE}/assets/share-abc.js`,
      error: /landing shell contains an external resource reference/,
    },
    {
      name: 'protocol-relative entry',
      source: `//lumenstudio.tech/_static/releases/${RELEASE}/assets/share-abc.js`,
      error: /landing shell contains an external resource reference/,
    },
  ]) {
    await context.test(definition.name, async (subcontext) => {
      const fixture = await createFixture(subcontext);
      const filename = path.join(fixture.distDirectory, 'landing.html');
      const html = await readFile(filename, 'utf8');
      await writeFile(
        filename,
        html.replace(
          '</head>',
          `<script type="module" src="${definition.source}"></script>\n</head>`,
        ),
      );

      await assert.rejects(
        packageFixture(fixture, path.join(fixture.root, `mixed-${definition.name}-output`)),
        definition.error,
      );
    });
  }
});

test('allows only approved non-loading external link hints', async (context) => {
  for (const definition of [
    {
      name: 'unapproved origin',
      link: '<link rel="preconnect" href="https://example.com">',
    },
    {
      name: 'mixed loading relation',
      link: '<link rel="preconnect stylesheet" href="https://clerk.lumenstudio.tech">',
    },
  ]) {
    await context.test(definition.name, async (subcontext) => {
      const fixture = await createFixture(subcontext);
      const filename = path.join(fixture.distDirectory, 'share.html');
      const html = await readFile(filename, 'utf8');
      await writeFile(filename, `${definition.link}\n${html}`);

      await assert.rejects(
        packageFixture(fixture, path.join(fixture.root, `external-hint-${definition.name}`)),
        /share shell contains an external resource reference/,
      );
    });
  }
});

test('requires localized landing metadata and a prerendered first screen', async (context) => {
  for (const definition of [
    {
      name: 'English lang',
      entryName: 'landing.html',
      replace: ['<html lang="en">', '<html lang="zh-CN">'],
      error: /landing shell must declare html lang en/,
    },
    {
      name: 'Chinese title',
      entryName: 'landing-zh.html',
      replace: ['<title>Lumen — 把商品变成爆款带货视频</title>', '<title>Wrong title</title>'],
      error: /landingZh shell has an invalid title/,
    },
    {
      name: 'static marker',
      entryName: 'landing.html',
      replace: ['data-lumen-static-landing="en"', 'data-lumen-static-landing="other"'],
      error: /landing shell is missing the static landing marker/,
    },
    {
      name: 'prerendered content',
      entryName: 'landing-zh.html',
      replace: ['<a href="/zh">静态中文首屏</a>', ''],
      error: /landingZh shell has an empty static first screen/,
    },
  ]) {
    await context.test(definition.name, async (subcontext) => {
      const fixture = await createFixture(subcontext);
      const filename = path.join(fixture.distDirectory, definition.entryName);
      const html = await readFile(filename, 'utf8');
      await writeFile(filename, html.replace(...definition.replace));

      await assert.rejects(
        packageFixture(fixture, path.join(fixture.root, `invalid-${definition.name}-output`)),
        definition.error,
      );
    });
  }
});

test('requires localized auth metadata, noindex, and a static loading screen', async (context) => {
  for (const definition of [
    {
      name: 'English lang',
      entryName: 'auth.html',
      replace: ['<html lang="en">', '<html lang="zh-CN">'],
      error: /auth shell must declare html lang en/,
    },
    {
      name: 'Chinese title',
      entryName: 'auth-zh.html',
      replace: ['<title>账户 — Lumen</title>', '<title>Wrong title</title>'],
      error: /authZh shell has an invalid title/,
    },
    {
      name: 'static marker',
      entryName: 'auth.html',
      replace: ['data-lumen-static-auth="en"', 'data-lumen-static-auth="other"'],
      error: /auth shell is missing the static auth marker/,
    },
    {
      name: 'robots metadata',
      entryName: 'auth-zh.html',
      replace: ['content="noindex, nofollow"', 'content="index, follow"'],
      error: /authZh shell must remain noindex/,
    },
    {
      name: 'loading screen',
      entryName: 'auth-zh.html',
      replace: ['class="auth-loading"', 'class="other"'],
      error: /authZh shell has an empty static auth screen/,
    },
  ]) {
    await context.test(definition.name, async (subcontext) => {
      const fixture = await createFixture(subcontext);
      const filename = path.join(fixture.distDirectory, definition.entryName);
      const html = await readFile(filename, 'utf8');
      await writeFile(filename, html.replace(...definition.replace));

      await assert.rejects(
        packageFixture(fixture, path.join(fixture.root, `invalid-auth-${definition.name}-output`)),
        definition.error,
      );
    });
  }
});

test('requires localized not-found metadata, noindex, and static recovery content', async (context) => {
  for (const definition of [
    {
      name: 'English lang',
      entryName: 'not-found.html',
      replace: ['<html lang="en">', '<html lang="zh-CN">'],
      error: /notFound shell must declare html lang en/,
    },
    {
      name: 'Chinese title',
      entryName: 'not-found-zh.html',
      replace: ['<title>页面不存在 — Lumen</title>', '<title>Wrong title</title>'],
      error: /notFoundZh shell has an invalid title/,
    },
    {
      name: 'static marker',
      entryName: 'not-found.html',
      replace: ['data-lumen-static-not-found="en"', 'data-lumen-static-not-found="other"'],
      error: /notFound shell is missing the static not-found marker/,
    },
    {
      name: 'robots metadata',
      entryName: 'not-found-zh.html',
      replace: ['content="noindex, nofollow"', 'content="index, follow"'],
      error: /notFoundZh shell must remain noindex/,
    },
    {
      name: 'recovery screen',
      entryName: 'not-found-zh.html',
      replace: ['class="not-found-content"', 'class="other"'],
      error: /notFoundZh shell has an empty static recovery screen/,
    },
  ]) {
    await context.test(definition.name, async (subcontext) => {
      const fixture = await createFixture(subcontext);
      const filename = path.join(fixture.distDirectory, definition.entryName);
      const html = await readFile(filename, 'utf8');
      await writeFile(filename, html.replace(...definition.replace));

      await assert.rejects(
        packageFixture(
          fixture,
          path.join(fixture.root, `invalid-not-found-${definition.name}-output`),
        ),
        definition.error,
      );
    });
  }
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
  await rm(path.join(symlinkFixture.distDirectory, 'assets'), {
    recursive: true,
    force: true,
  });
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

test('serves every packaged shell and immutable shell reference through the edge worker', async (context) => {
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
  const environment = {
    ACTIVE_FRONTEND_RELEASE: RELEASE,
    FRONTEND_BUCKET: bucket,
  };
  const executionContext = { waitUntil() {} };

  for (const [pathname, expectedStatus] of [
    ['/app/dashboard', 200],
    ['/share/0123456789abcdef0123456789abcdef', 200],
    ['/sign-in/verify', 200],
    ['/zh/sign-up', 200],
    ['/', 200],
    ['/zh', 200],
    ['/missing-page', 404],
    ['/zh/missing-page', 404],
  ]) {
    const shellResponse = await worker.fetch(
      new Request(`https://lumenstudio.tech${pathname}`),
      environment,
      executionContext,
    );
    assert.equal(shellResponse.status, expectedStatus, pathname);
    assert.equal(shellResponse.headers.get('x-lumen-release'), RELEASE);
    const shell = await shellResponse.text();
    const references = [...shell.matchAll(/\b(?:href|src)=["']([^"']+)["']/gi)]
      .map((match) => match[1])
      .filter((reference) => reference.startsWith('/_static/releases/'));
    assert.ok(references.length >= 3, pathname);

    for (const reference of references) {
      const response = await worker.fetch(
        new Request(`https://lumenstudio.tech${reference}`),
        environment,
        executionContext,
      );
      assert.equal(response.status, 200, `${pathname}: ${reference}`);
      assert.equal(response.headers.get('cache-control'), 'public, max-age=31536000, immutable');
    }
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
    writeFixtureFile(
      path.join(distDirectory, 'assets', 'share-abc.js'),
      `export const share = '${'versioned-share-javascript-'.repeat(200)}';\n`,
    ),
    writeFixtureFile(
      path.join(distDirectory, 'assets', 'share-abc.css'),
      `.share{color:#fff;background:${'#202020 '.repeat(200)}}\n`,
    ),
    writeFixtureFile(
      path.join(distDirectory, 'assets', 'auth-abc.js'),
      `export const auth = '${'versioned-auth-javascript-'.repeat(200)}';\n`,
    ),
    writeFixtureFile(
      path.join(distDirectory, 'assets', 'auth-abc.css'),
      `.auth{color:#fff;background:${'#252525 '.repeat(200)}}\n`,
    ),
    writeFixtureFile(
      path.join(distDirectory, 'assets', 'auth-zh-abc.js'),
      `export const authZh = '${'versioned-auth-zh-javascript-'.repeat(200)}';\n`,
    ),
    writeFixtureFile(
      path.join(distDirectory, 'assets', 'auth-zh-abc.css'),
      `.auth-zh{color:#fff;background:${'#282828 '.repeat(200)}}\n`,
    ),
    writeFixtureFile(
      path.join(distDirectory, 'assets', 'not-found-abc.js'),
      `export const notFound = '${'versioned-not-found-javascript-'.repeat(200)}';\n`,
    ),
    writeFixtureFile(
      path.join(distDirectory, 'assets', 'not-found-abc.css'),
      `.not-found{color:#fff;background:${'#292929 '.repeat(200)}}\n`,
    ),
    writeFixtureFile(
      path.join(distDirectory, 'assets', 'not-found-zh-abc.js'),
      `export const notFoundZh = '${'versioned-not-found-zh-javascript-'.repeat(200)}';\n`,
    ),
    writeFixtureFile(
      path.join(distDirectory, 'assets', 'not-found-zh-abc.css'),
      `.not-found-zh{color:#fff;background:${'#2b2b2b '.repeat(200)}}\n`,
    ),
    writeFixtureFile(
      path.join(distDirectory, 'assets', 'landing-abc.js'),
      `export const landing = '${'versioned-landing-javascript-'.repeat(200)}';\n`,
    ),
    writeFixtureFile(
      path.join(distDirectory, 'assets', 'landing-abc.css'),
      `.landing{color:#fff;background:${'#303030 '.repeat(200)}}\n`,
    ),
    writeFixtureFile(
      path.join(distDirectory, 'assets', 'landing-zh-abc.js'),
      `export const landingZh = '${'versioned-landing-zh-javascript-'.repeat(200)}';\n`,
    ),
    writeFixtureFile(
      path.join(distDirectory, 'assets', 'landing-zh-abc.css'),
      `.landing-zh{color:#fff;background:${'#404040 '.repeat(200)}}\n`,
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
      'share.html': {
        file: 'assets/share-abc.js',
        css: ['assets/share-abc.css'],
        isEntry: true,
      },
      'auth.html': {
        file: 'assets/auth-abc.js',
        css: ['assets/auth-abc.css'],
        isEntry: true,
      },
      'auth-zh.html': {
        file: 'assets/auth-zh-abc.js',
        css: ['assets/auth-zh-abc.css'],
        isEntry: true,
      },
      'not-found.html': {
        file: 'assets/not-found-abc.js',
        css: ['assets/not-found-abc.css'],
        isEntry: true,
      },
      'not-found-zh.html': {
        file: 'assets/not-found-zh-abc.js',
        css: ['assets/not-found-zh-abc.css'],
        isEntry: true,
      },
      'landing.html': {
        file: 'assets/landing-abc.js',
        css: ['assets/landing-abc.css'],
        isEntry: true,
      },
      'landing-zh.html': {
        file: 'assets/landing-zh-abc.js',
        css: ['assets/landing-zh-abc.css'],
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
      '<link rel="dns-prefetch" href="https://clerk.lumenstudio.tech">',
      '<link rel="preconnect" href="https://img.clerk.com" crossorigin>',
      `<link rel="icon" href="/_static/releases/${RELEASE}/icon.svg">`,
      `<link rel="stylesheet" href="/_static/releases/${RELEASE}/assets/index-abc.css">`,
      `<script type="module" src="/_static/releases/${RELEASE}/assets/index-abc.js"></script>`,
    ].join('\n'),
  );
  await writeFixtureFile(
    path.join(distDirectory, 'share.html'),
    [
      '<!doctype html>',
      '<link rel="dns-prefetch" href="https://clerk.lumenstudio.tech">',
      '<link rel="preconnect" href="https://img.clerk.com" crossorigin>',
      `<link rel="icon" href="/_static/releases/${RELEASE}/icon.svg">`,
      `<link rel="stylesheet" href="/_static/releases/${RELEASE}/assets/share-abc.css">`,
      `<script type="module" src="/_static/releases/${RELEASE}/assets/share-abc.js"></script>`,
    ].join('\n'),
  );
  await writeFixtureFile(
    path.join(distDirectory, 'auth.html'),
    [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<title>Account — Lumen</title>',
      '<meta name="robots" content="noindex, nofollow">',
      '<link rel="dns-prefetch" href="https://clerk.lumenstudio.tech">',
      '<link rel="preconnect" href="https://img.clerk.com" crossorigin>',
      `<link rel="icon" href="/_static/releases/${RELEASE}/icon.svg">`,
      `<link rel="stylesheet" href="/_static/releases/${RELEASE}/assets/auth-abc.css">`,
      '</head>',
      '<body>',
      '<div id="root" data-lumen-static-auth="en"><div class="auth-loading">Loading account</div></div>',
      `<script type="module" src="/_static/releases/${RELEASE}/assets/auth-abc.js"></script>`,
      '</body>',
      '</html>',
    ].join('\n'),
  );
  await writeFixtureFile(
    path.join(distDirectory, 'auth-zh.html'),
    [
      '<!doctype html>',
      '<html lang="zh-CN">',
      '<head>',
      '<title>账户 — Lumen</title>',
      '<meta name="robots" content="noindex, nofollow">',
      '<link rel="dns-prefetch" href="https://clerk.lumenstudio.tech">',
      '<link rel="preconnect" href="https://img.clerk.com" crossorigin>',
      `<link rel="icon" href="/_static/releases/${RELEASE}/icon.svg">`,
      `<link rel="stylesheet" href="/_static/releases/${RELEASE}/assets/auth-zh-abc.css">`,
      '</head>',
      '<body>',
      '<div id="root" data-lumen-static-auth="zh"><div class="auth-loading">正在加载账户</div></div>',
      `<script type="module" src="/_static/releases/${RELEASE}/assets/auth-zh-abc.js"></script>`,
      '</body>',
      '</html>',
    ].join('\n'),
  );
  await writeFixtureFile(
    path.join(distDirectory, 'not-found.html'),
    [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<title>Page not found — Lumen</title>',
      '<meta name="robots" content="noindex, nofollow">',
      `<link rel="icon" href="/_static/releases/${RELEASE}/icon.svg">`,
      `<link rel="stylesheet" href="/_static/releases/${RELEASE}/assets/not-found-abc.css">`,
      '</head>',
      '<body>',
      '<div id="root" data-lumen-static-not-found="en"><main class="not-found-content">404 — Page not found</main></div>',
      `<script type="module" src="/_static/releases/${RELEASE}/assets/not-found-abc.js"></script>`,
      '</body>',
      '</html>',
    ].join('\n'),
  );
  await writeFixtureFile(
    path.join(distDirectory, 'not-found-zh.html'),
    [
      '<!doctype html>',
      '<html lang="zh-CN">',
      '<head>',
      '<title>页面不存在 — Lumen</title>',
      '<meta name="robots" content="noindex, nofollow">',
      `<link rel="icon" href="/_static/releases/${RELEASE}/icon.svg">`,
      `<link rel="stylesheet" href="/_static/releases/${RELEASE}/assets/not-found-zh-abc.css">`,
      '</head>',
      '<body>',
      '<div id="root" data-lumen-static-not-found="zh"><main class="not-found-content">404 — 页面不存在</main></div>',
      `<script type="module" src="/_static/releases/${RELEASE}/assets/not-found-zh-abc.js"></script>`,
      '</body>',
      '</html>',
    ].join('\n'),
  );
  await writeFixtureFile(
    path.join(distDirectory, 'landing.html'),
    [
      '<!doctype html>',
      '<html lang="en">',
      '<head>',
      '<title>Lumen — Turn products into videos that sell</title>',
      '<link rel="canonical" href="https://lumenstudio.tech/">',
      '<link rel="alternate" hreflang="zh" href="https://lumenstudio.tech/zh">',
      `<link rel="icon" href="/_static/releases/${RELEASE}/icon.svg">`,
      `<link rel="stylesheet" href="/_static/releases/${RELEASE}/assets/landing-abc.css">`,
      '</head>',
      '<body>',
      '<div id="root" data-lumen-prerendered="true" data-lumen-static-landing="en"><a href="/app/home">Static English landing</a></div>',
      `<script type="module" src="/_static/releases/${RELEASE}/assets/landing-abc.js"></script>`,
      '</body>',
      '</html>',
    ].join('\n'),
  );
  await writeFixtureFile(
    path.join(distDirectory, 'landing-zh.html'),
    [
      '<!doctype html>',
      '<html lang="zh-CN">',
      '<head>',
      '<title>Lumen — 把商品变成爆款带货视频</title>',
      `<link rel="icon" href="/_static/releases/${RELEASE}/icon.svg">`,
      `<link rel="stylesheet" href="/_static/releases/${RELEASE}/assets/landing-zh-abc.css">`,
      '</head>',
      '<body>',
      '<div id="root" data-lumen-prerendered="true" data-lumen-static-landing="zh"><a href="/zh">静态中文首屏</a></div>',
      `<script type="module" src="/_static/releases/${RELEASE}/assets/landing-zh-abc.js"></script>`,
      '</body>',
      '</html>',
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
