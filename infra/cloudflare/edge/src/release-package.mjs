import { createHash } from 'node:crypto';
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { brotliCompress, gzip, constants as zlibConstants } from 'node:zlib';
import { validateReleasePath } from './release-path.mjs';

const compressBrotli = promisify(brotliCompress);
const compressGzip = promisify(gzip);
const FULL_RELEASE_PATTERN = /^[0-9a-f]{40}$/;
const COMPRESSIBLE_FILE_PATTERN = /\.(?:css|html|js|json|mjs|svg|txt|xml)$/i;
const RELEASE_SCOPE = ['app', 'share', 'landing', 'auth', 'not-found'];
const RELEASE_SHELLS = {
  app: 'app/index.html',
  share: 'share/index.html',
  landing: 'index.html',
  landingZh: 'zh/index.html',
  auth: 'auth/index.html',
  authZh: 'auth/zh/index.html',
  notFound: '404.html',
  notFoundZh: 'zh/404.html',
};
const BUILD_SHELLS = [
  { name: 'app', entry: 'index.html', output: RELEASE_SHELLS.app },
  { name: 'share', entry: 'share.html', output: RELEASE_SHELLS.share },
  {
    name: 'auth',
    entry: 'auth.html',
    output: RELEASE_SHELLS.auth,
    document: {
      kind: 'auth',
      lang: 'en',
      marker: 'en',
      title: 'Account — Lumen',
    },
  },
  {
    name: 'authZh',
    entry: 'auth-zh.html',
    output: RELEASE_SHELLS.authZh,
    document: {
      kind: 'auth',
      lang: 'zh-CN',
      marker: 'zh',
      title: '账户 — Lumen',
    },
  },
  {
    name: 'landing',
    entry: 'landing.html',
    output: RELEASE_SHELLS.landing,
    document: {
      kind: 'landing',
      lang: 'en',
      marker: 'en',
      title: 'Lumen — Turn products into videos that sell',
    },
  },
  {
    name: 'landingZh',
    entry: 'landing-zh.html',
    output: RELEASE_SHELLS.landingZh,
    document: {
      kind: 'landing',
      lang: 'zh-CN',
      marker: 'zh',
      title: 'Lumen — 把商品变成爆款带货视频',
    },
  },
  {
    name: 'notFound',
    entry: 'not-found.html',
    output: RELEASE_SHELLS.notFound,
    document: {
      kind: 'not-found',
      lang: 'en',
      marker: 'en',
      title: 'Page not found — Lumen',
    },
  },
  {
    name: 'notFoundZh',
    entry: 'not-found-zh.html',
    output: RELEASE_SHELLS.notFoundZh,
    document: {
      kind: 'not-found',
      lang: 'zh-CN',
      marker: 'zh',
      title: '页面不存在 — Lumen',
    },
  },
];
const APP_PUBLIC_DIRECTORIES = ['home-posters'];
const STUDIO_PUBLIC_DIRECTORIES = [
  'home-posters',
  'home-templates',
  'material-showcase',
  'particle-masks',
];
const ALLOWED_CONNECTION_HINT_ORIGINS = new Set([
  'https://clerk.lumenstudio.tech',
  'https://img.clerk.com',
]);

export async function packageAppRelease({
  release,
  distDirectory,
  appPublicDirectory,
  studioPublicDirectory,
  iconFile,
  outputRoot,
}) {
  const normalizedRelease = normalizeRelease(release);
  await Promise.all([
    requireDirectory(distDirectory, 'app build directory'),
    requireDirectory(appPublicDirectory, 'app public directory'),
    requireDirectory(studioPublicDirectory, 'studio public directory'),
    requireRegularFile(iconFile, 'app icon'),
    prepareOutputRoot(outputRoot),
  ]);

  const releaseDirectory = path.join(outputRoot, normalizedRelease);
  const existingRelease = await lstat(releaseDirectory).catch(() => null);
  if (existingRelease && (!existingRelease.isDirectory() || existingRelease.isSymbolicLink())) {
    throw new Error(`release output target is unsafe: ${releaseDirectory}`);
  }
  await rm(releaseDirectory, { recursive: true, force: true });
  await mkdir(releaseDirectory, { recursive: true });

  const buildMetadataBytes = await readBuildFile(
    distDirectory,
    '.vite/lumen-build.json',
    'frontend build metadata',
  );
  const buildMetadata = readBuildMetadata(buildMetadataBytes, normalizedRelease);
  const viteManifestPath = path.join(distDirectory, '.vite', 'manifest.json');
  const viteManifestBytes = await readBuildFile(
    distDirectory,
    '.vite/manifest.json',
    'Vite manifest',
  );
  const viteManifest = readViteManifest(viteManifestBytes, viteManifestPath);
  const buildAssets = collectBuildAssets(viteManifest);

  for (const assetPath of buildAssets) {
    await stageBuildAsset(
      distDirectory,
      path.join(releaseDirectory, ...assetPath.split('/')),
      assetPath,
    );
  }

  for (const directoryName of APP_PUBLIC_DIRECTORIES) {
    await copyReleaseDirectoryContents(
      path.join(appPublicDirectory, directoryName),
      path.join(releaseDirectory, directoryName),
      directoryName,
    );
  }
  for (const directoryName of STUDIO_PUBLIC_DIRECTORIES) {
    await copyReleaseDirectoryContents(
      path.join(studioPublicDirectory, directoryName),
      path.join(releaseDirectory, directoryName),
      directoryName,
    );
  }
  await copyReleaseFile(iconFile, path.join(releaseDirectory, 'icon.svg'), 'icon.svg');

  for (const shell of BUILD_SHELLS) {
    const html = await readBuildFile(
      distDirectory,
      shell.entry,
      `built ${shell.name} shell`,
      'utf8',
    );
    const outputPath = path.join(releaseDirectory, ...shell.output.split('/'));
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, html);
    await verifyShell({
      html,
      shellName: shell.name,
      entryKey: shell.entry,
      release: normalizedRelease,
      releaseDirectory,
      viteManifest,
      documentContract: shell.document,
    });
  }

  const originalFiles = await listReleaseFiles(releaseDirectory);
  const originalFileSet = new Set(originalFiles);
  for (const relativePath of originalFiles) {
    if (!COMPRESSIBLE_FILE_PATTERN.test(relativePath)) continue;
    for (const extension of ['.br', '.gz']) {
      if (originalFileSet.has(`${relativePath}${extension}`)) {
        throw new Error(
          `release sources reserve a generated compression key: ${relativePath}${extension}`,
        );
      }
    }
  }
  for (const relativePath of originalFiles) {
    if (!COMPRESSIBLE_FILE_PATTERN.test(relativePath)) continue;
    await writeCompressedVariants(releaseDirectory, relativePath);
  }

  const payloadFiles = await describeReleaseFiles(releaseDirectory);
  const manifest = {
    schemaVersion: 1,
    release: normalizedRelease,
    scope: [...RELEASE_SCOPE],
    shells: { ...RELEASE_SHELLS },
    assetBase: `/_static/releases/${normalizedRelease}/`,
    buildConfigFingerprint: buildMetadata.buildConfigFingerprint,
    buildMetadataSha256: digest(buildMetadataBytes),
    sourceManifestSha256: digest(viteManifestBytes),
    files: payloadFiles,
  };
  const manifestBytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  await writeFile(path.join(releaseDirectory, 'release-manifest.json'), manifestBytes);

  const ready = {
    schemaVersion: 1,
    release: normalizedRelease,
    scope: [...RELEASE_SCOPE],
    manifest: {
      path: 'release-manifest.json',
      sha256: digest(manifestBytes),
    },
    objectCount: payloadFiles.length + 2,
  };
  await writeFile(
    path.join(releaseDirectory, '_READY.json'),
    `${JSON.stringify(ready, null, 2)}\n`,
  );

  return {
    release: normalizedRelease,
    releaseDirectory,
    objectCount: ready.objectCount,
    manifest,
    ready,
  };
}

export function normalizeRelease(release) {
  const normalized = String(release ?? '')
    .trim()
    .toLowerCase();
  if (!FULL_RELEASE_PATTERN.test(normalized)) {
    throw new Error('frontend release must be a full 40-character lowercase git SHA');
  }
  return normalized;
}

function readViteManifest(bytes, filename) {
  let manifest;
  try {
    manifest = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error(`invalid Vite manifest at ${filename}`, { cause: error });
  }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) {
    throw new Error(`invalid Vite manifest at ${filename}`);
  }
  return manifest;
}

function readBuildMetadata(bytes, release) {
  let metadata;
  try {
    metadata = JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    throw new Error('invalid frontend build metadata', { cause: error });
  }
  const expectedAssetBase = `/_static/releases/${release}/`;
  if (
    !metadata ||
    typeof metadata !== 'object' ||
    Array.isArray(metadata) ||
    metadata.schemaVersion !== 1 ||
    metadata.release !== release ||
    metadata.assetBase !== expectedAssetBase ||
    typeof metadata.buildConfigFingerprint !== 'string' ||
    !/^[0-9a-f]{64}$/.test(metadata.buildConfigFingerprint)
  ) {
    throw new Error('frontend build metadata does not match the requested release');
  }
  return metadata;
}

function collectBuildAssets(manifest) {
  const manifestKeys = new Set(Object.keys(manifest));
  for (const shell of BUILD_SHELLS) {
    const entry = manifest[shell.entry];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) || entry.isEntry !== true) {
      throw new Error(`Vite manifest is missing the ${shell.entry} entry`);
    }
  }
  const expectedEntryKeys = BUILD_SHELLS.map((shell) => shell.entry).sort();
  const actualEntryKeys = Object.entries(manifest)
    .filter(([, entry]) => entry?.isEntry === true)
    .map(([key]) => key)
    .sort();
  if (
    actualEntryKeys.length !== expectedEntryKeys.length ||
    actualEntryKeys.some((key, index) => key !== expectedEntryKeys[index])
  ) {
    throw new Error(`Vite manifest entry set must be exactly ${expectedEntryKeys.join(', ')}`);
  }
  const files = new Set();
  for (const [manifestKey, manifestEntry] of Object.entries(manifest)) {
    if (!manifestEntry || typeof manifestEntry !== 'object' || Array.isArray(manifestEntry)) {
      throw new Error('Vite manifest contains an invalid entry');
    }
    if (manifestEntry.file === undefined) {
      throw new Error(`Vite manifest entry ${manifestKey} is missing its file`);
    }
    addBuildAsset(files, manifestEntry.file);
    for (const field of ['css', 'assets']) {
      if (manifestEntry[field] === undefined) continue;
      if (!Array.isArray(manifestEntry[field])) {
        throw new Error(`Vite manifest entry ${field} must be an array`);
      }
      for (const filename of manifestEntry[field]) addBuildAsset(files, filename);
    }
    for (const field of ['imports', 'dynamicImports']) {
      if (manifestEntry[field] === undefined) continue;
      if (!Array.isArray(manifestEntry[field])) {
        throw new Error(`Vite manifest entry ${field} must be an array`);
      }
      for (const importedKey of manifestEntry[field]) {
        if (typeof importedKey !== 'string' || !manifestKeys.has(importedKey)) {
          throw new Error(
            `Vite manifest entry ${manifestKey} references missing ${field} entry ${importedKey}`,
          );
        }
      }
    }
  }
  if (files.size === 0) throw new Error('Vite manifest does not contain build assets');
  return [...files].sort();
}

function addBuildAsset(files, filename) {
  if (typeof filename !== 'string') throw new Error('Vite manifest asset path must be a string');
  const normalized = validateReleasePath(filename);
  if (!normalized.startsWith('assets/')) {
    throw new Error(`Vite manifest asset is outside assets/: ${filename}`);
  }
  files.add(normalized);
}

async function verifyShell({
  html,
  shellName,
  entryKey,
  release,
  releaseDirectory,
  viteManifest,
  documentContract,
}) {
  const immutableBase = `/_static/releases/${release}/`;
  const references = readHtmlReferences(html, shellName);
  const immutableReferences = [];
  const allowedEntryAssets = collectEntryAssetClosure(viteManifest, entryKey);
  for (const reference of references) {
    if (reference.startsWith('#')) continue;
    if (isExternalHtmlReference(reference)) {
      throw new Error(`${shellName} shell contains an external resource reference: ${reference}`);
    }
    if (!reference.startsWith(immutableBase)) {
      throw new Error(`${shellName} shell contains an unversioned local reference: ${reference}`);
    }
    immutableReferences.push(reference);
  }
  if (immutableReferences.length === 0) {
    throw new Error(`${shellName} shell does not contain versioned release references`);
  }
  const packagedReferences = new Set();
  for (const reference of immutableReferences) {
    const relativePath = validateReleasePath(
      reference.slice(immutableBase.length).split(/[?#]/, 1)[0],
    );
    if (relativePath !== 'icon.svg' && !relativePath.startsWith('assets/')) {
      throw new Error(
        `${shellName} shell reference is outside the edge asset allowlist: ${reference}`,
      );
    }
    await requireRegularFile(
      path.join(releaseDirectory, ...relativePath.split('/')),
      `${shellName} shell reference ${reference}`,
    );
    packagedReferences.add(relativePath);
  }
  const entry = viteManifest[entryKey];
  for (const requiredPath of [entry.file, ...(entry.css ?? [])]) {
    if (!packagedReferences.has(requiredPath)) {
      throw new Error(
        `${shellName} shell does not reference required entry asset: ${requiredPath}`,
      );
    }
  }
  for (const relativePath of packagedReferences) {
    if (relativePath !== 'icon.svg' && !allowedEntryAssets.has(relativePath)) {
      throw new Error(
        `${shellName} shell references an asset outside its entry closure: ${relativePath}`,
      );
    }
  }
  if (documentContract?.kind === 'landing') {
    verifyLandingDocument(html, shellName, documentContract);
  }
  if (documentContract?.kind === 'auth') {
    verifyAuthDocument(html, shellName, documentContract);
  }
  if (documentContract?.kind === 'not-found') {
    verifyNotFoundDocument(html, shellName, documentContract);
  }
}

function collectEntryAssetClosure(viteManifest, entryKey) {
  const assets = new Set();
  const visited = new Set();
  const queue = [entryKey];

  while (queue.length > 0) {
    const key = queue.shift();
    if (!key || visited.has(key)) continue;
    visited.add(key);

    const entry = viteManifest[key];
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
      throw new Error(`Vite manifest entry closure is missing ${key}`);
    }
    for (const filename of [entry.file, ...(entry.css ?? []), ...(entry.assets ?? [])]) {
      assets.add(validateReleasePath(filename));
    }
    queue.push(...(entry.imports ?? []));
  }

  return assets;
}

function verifyLandingDocument(html, shellName, contract) {
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? '';
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1].trim();
  const rootMatch = html.match(/<div\b[^>]*\bid\s*=\s*(["'])root\1[^>]*>/i);
  const rootTag = rootMatch?.[0] ?? '';
  const afterRoot = rootMatch ? html.slice(rootMatch.index + rootTag.length).trimStart() : '';

  if (!hasHtmlAttribute(htmlTag, 'lang', contract.lang)) {
    throw new Error(`${shellName} shell must declare html lang ${contract.lang}`);
  }
  if (title !== contract.title) {
    throw new Error(`${shellName} shell has an invalid title`);
  }
  if (!hasHtmlAttribute(rootTag, 'data-lumen-prerendered', 'true')) {
    throw new Error(`${shellName} shell is missing the prerender marker`);
  }
  if (!hasHtmlAttribute(rootTag, 'data-lumen-static-landing', contract.marker)) {
    throw new Error(`${shellName} shell is missing the static landing marker`);
  }
  if (!afterRoot || afterRoot.startsWith('</div>')) {
    throw new Error(`${shellName} shell has an empty static first screen`);
  }
}

function verifyAuthDocument(html, shellName, contract) {
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? '';
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1].trim();
  const rootMatch = html.match(/<div\b[^>]*\bid\s*=\s*(["'])root\1[^>]*>/i);
  const rootTag = rootMatch?.[0] ?? '';
  const afterRoot = rootMatch ? html.slice(rootMatch.index + rootTag.length).trimStart() : '';
  const robotsTag = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((tag) => hasHtmlAttribute(tag, 'name', 'robots'));

  if (!hasHtmlAttribute(htmlTag, 'lang', contract.lang)) {
    throw new Error(`${shellName} shell must declare html lang ${contract.lang}`);
  }
  if (title !== contract.title) {
    throw new Error(`${shellName} shell has an invalid title`);
  }
  if (!hasHtmlAttribute(rootTag, 'data-lumen-static-auth', contract.marker)) {
    throw new Error(`${shellName} shell is missing the static auth marker`);
  }
  if (!robotsTag || !hasHtmlAttribute(robotsTag, 'content', 'noindex, nofollow')) {
    throw new Error(`${shellName} shell must remain noindex`);
  }
  if (!afterRoot || afterRoot.startsWith('</div>') || !afterRoot.includes('auth-loading')) {
    throw new Error(`${shellName} shell has an empty static auth screen`);
  }
}

function verifyNotFoundDocument(html, shellName, contract) {
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? '';
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1].trim();
  const rootMatch = html.match(/<div\b[^>]*\bid\s*=\s*(["'])root\1[^>]*>/i);
  const rootTag = rootMatch?.[0] ?? '';
  const afterRoot = rootMatch ? html.slice(rootMatch.index + rootTag.length).trimStart() : '';
  const robotsTag = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((tag) => hasHtmlAttribute(tag, 'name', 'robots'));

  if (!hasHtmlAttribute(htmlTag, 'lang', contract.lang)) {
    throw new Error(`${shellName} shell must declare html lang ${contract.lang}`);
  }
  if (title !== contract.title) {
    throw new Error(`${shellName} shell has an invalid title`);
  }
  if (!hasHtmlAttribute(rootTag, 'data-lumen-static-not-found', contract.marker)) {
    throw new Error(`${shellName} shell is missing the static not-found marker`);
  }
  if (!robotsTag || !hasHtmlAttribute(robotsTag, 'content', 'noindex, nofollow')) {
    throw new Error(`${shellName} shell must remain noindex`);
  }
  if (
    !afterRoot ||
    afterRoot.startsWith('</div>') ||
    !afterRoot.includes('not-found-content') ||
    !afterRoot.includes('404')
  ) {
    throw new Error(`${shellName} shell has an empty static recovery screen`);
  }
}

function hasHtmlAttribute(tag, name, value) {
  return new RegExp(`\\b${escapePattern(name)}\\s*=\\s*(["'])${escapePattern(value)}\\1`, 'i').test(
    tag,
  );
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function copyReleaseDirectoryContents(source, target, relativePath) {
  const sourceStats = await lstat(source).catch(() => null);
  if (!sourceStats?.isDirectory() || sourceStats.isSymbolicLink()) {
    throw new Error(`release source directory is missing or unsafe: ${relativePath}`);
  }
  const targetStats = await lstat(target).catch(() => null);
  if (targetStats && (!targetStats.isDirectory() || targetStats.isSymbolicLink())) {
    throw new Error(`release sources collide at ${relativePath}`);
  }
  if (!targetStats) await mkdir(target, { recursive: true });
  const entries = await readdir(source, { withFileTypes: true });
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const childPath = validateReleasePath(`${relativePath}/${entry.name}`);
    if (entry.isDirectory()) {
      await copyReleaseDirectoryContents(
        path.join(source, entry.name),
        path.join(target, entry.name),
        childPath,
      );
    } else {
      await copyReleaseTree(
        path.join(source, entry.name),
        path.join(target, entry.name),
        childPath,
      );
    }
  }
}

function readHtmlReferences(html, shellName) {
  const references = [];
  for (const tagMatch of html.matchAll(/<([a-z][a-z0-9:-]*)\b([^<>]*)>/gi)) {
    const tagName = tagMatch[1].toLowerCase();
    const attributes = tagMatch[2];
    for (const attributeMatch of attributes.matchAll(/\b(href|src|srcset)\s*=\s*/gi)) {
      const attributeName = attributeMatch[1].toLowerCase();
      const valueStart = attributeMatch.index + attributeMatch[0].length;
      const quote = attributes[valueStart];
      if (quote !== '"' && quote !== "'") {
        throw new Error(`${shellName} shell contains an unquoted URL attribute`);
      }
      const valueEnd = attributes.indexOf(quote, valueStart + 1);
      if (valueEnd < 0) {
        throw new Error(`${shellName} shell contains an unterminated URL attribute`);
      }
      const value = attributes.slice(valueStart + 1, valueEnd);
      if (attributeName === 'href' && (tagName === 'a' || tagName === 'area')) continue;
      if (
        attributeName === 'href' &&
        tagName === 'link' &&
        isAllowedNonAssetLink(attributes, value)
      ) {
        continue;
      }
      if (attributeName !== 'srcset') {
        references.push(value);
        continue;
      }

      const srcset = value.trim();
      if (srcset.startsWith('data:')) {
        if (!/^data:\S+(?:\s+\S+)?$/.test(srcset)) {
          throw new Error(`${shellName} shell contains an ambiguous data URL srcset`);
        }
        continue;
      }
      for (const candidate of srcset.split(',')) {
        const [reference] = candidate.trim().split(/\s+/, 1);
        if (reference) references.push(reference);
      }
    }
  }
  return references;
}

function isExternalHtmlReference(reference) {
  return reference.startsWith('//') || /^[a-z][a-z0-9+.-]*:/i.test(reference);
}

function isAllowedNonAssetLink(attributes, href) {
  const relation = readQuotedHtmlAttribute(attributes, 'rel');
  if (!relation) return false;
  const tokens = relation.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  if (tokens.every((token) => token === 'alternate' || token === 'canonical')) return true;
  if (tokens.length !== 1 || (tokens[0] !== 'dns-prefetch' && tokens[0] !== 'preconnect')) {
    return false;
  }
  return isAllowedConnectionHint(href);
}

function isAllowedConnectionHint(href) {
  let url;
  try {
    url = new URL(href.startsWith('//') ? `https:${href}` : href);
  } catch {
    return false;
  }
  return (
    ALLOWED_CONNECTION_HINT_ORIGINS.has(url.origin) &&
    url.pathname === '/' &&
    !url.search &&
    !url.hash &&
    !url.username &&
    !url.password
  );
}

function readQuotedHtmlAttribute(attributes, name) {
  const match = attributes.match(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match?.[2] ?? null;
}

async function copyReleaseTree(source, target, relativePath) {
  validateReleasePath(relativePath);
  const sourceStat = await lstat(source);
  if (sourceStat.isSymbolicLink()) {
    throw new Error(`release source must not contain symbolic links: ${relativePath}`);
  }
  if (await pathExists(target)) {
    throw new Error(`release sources collide at ${relativePath}`);
  }
  if (sourceStat.isDirectory()) {
    await mkdir(target, { recursive: false });
    const entries = await readdir(source, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      const childPath = validateReleasePath(`${relativePath}/${entry.name}`);
      await copyReleaseTree(
        path.join(source, entry.name),
        path.join(target, entry.name),
        childPath,
      );
    }
    return;
  }
  if (!sourceStat.isFile()) {
    throw new Error(`release source must be a regular file: ${relativePath}`);
  }
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function copyReleaseFile(source, target, relativePath) {
  validateReleasePath(relativePath);
  await requireRegularFile(source, `release source ${relativePath}`);
  if (await pathExists(target)) throw new Error(`release sources collide at ${relativePath}`);
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(source, target);
}

async function stageBuildAsset(distDirectory, target, relativePath) {
  validateReleasePath(relativePath);
  const source = await requireBuildFile(
    distDirectory,
    relativePath,
    `release source ${relativePath}`,
  );
  if (await pathExists(target)) throw new Error(`release sources collide at ${relativePath}`);
  await mkdir(path.dirname(target), { recursive: true });
  if (/\.(?:css|js|mjs)$/i.test(relativePath)) {
    const contents = await readFile(source, 'utf8');
    if (hasSourceMapReference(contents)) {
      throw new Error(`release build contains a source map reference: ${relativePath}`);
    }
  }
  await copyFile(source, target);
}

function hasSourceMapReference(contents) {
  return (
    /^\s*\/\/[#@]\s*sourceMappingURL=\S+\s*$/m.test(contents) ||
    /\/\*[#@]\s*sourceMappingURL=[^*]+\*\//.test(contents)
  );
}

async function writeCompressedVariants(releaseDirectory, relativePath) {
  const source = await readFile(path.join(releaseDirectory, ...relativePath.split('/')));
  const [brotli, gzipped] = await Promise.all([
    compressBrotli(source, {
      params: {
        [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
        [zlibConstants.BROTLI_PARAM_QUALITY]: 11,
      },
    }),
    compressGzip(source, { level: 9, mtime: 0 }),
  ]);
  if (brotli.byteLength < source.byteLength) {
    await writeFile(path.join(releaseDirectory, ...`${relativePath}.br`.split('/')), brotli, {
      flag: 'wx',
    });
  }
  if (gzipped.byteLength < source.byteLength) {
    await writeFile(path.join(releaseDirectory, ...`${relativePath}.gz`.split('/')), gzipped, {
      flag: 'wx',
    });
  }
}

async function describeReleaseFiles(releaseDirectory) {
  const files = await listReleaseFiles(releaseDirectory);
  return Promise.all(
    files.map(async (relativePath) => {
      const bytes = await readFile(path.join(releaseDirectory, ...relativePath.split('/')));
      const encoding = relativePath.endsWith('.br')
        ? 'br'
        : relativePath.endsWith('.gz')
          ? 'gzip'
          : null;
      const sourcePath = encoding ? relativePath.replace(/\.(?:br|gz)$/, '') : relativePath;
      return {
        path: relativePath,
        size: bytes.byteLength,
        sha256: digest(bytes),
        contentType: contentTypeFor(sourcePath),
        ...(encoding ? { contentEncoding: encoding } : {}),
      };
    }),
  );
}

async function listReleaseFiles(directory, relativeDirectory = '') {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const relativePath = validateReleasePath(
      relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name,
    );
    const absolutePath = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`release output must not contain symbolic links: ${relativePath}`);
    }
    if (entry.isDirectory()) {
      files.push(...(await listReleaseFiles(absolutePath, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    } else {
      throw new Error(`release output must contain only regular files: ${relativePath}`);
    }
  }
  return files.sort();
}

async function requireDirectory(filename, label) {
  const stats = await lstat(filename).catch(() => null);
  if (!stats?.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`${label} is missing or is not a directory: ${filename}`);
  }
}

async function prepareOutputRoot(filename) {
  if (typeof filename !== 'string' || filename.length === 0) {
    throw new Error('release output root is required');
  }
  await mkdir(filename, { recursive: true });
  const stats = await lstat(filename).catch(() => null);
  if (!stats?.isDirectory() || stats.isSymbolicLink()) {
    throw new Error(`release output root is missing or unsafe: ${filename}`);
  }
}

async function requireRegularFile(filename, label) {
  const stats = await lstat(filename).catch(() => null);
  if (!stats?.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} is missing or is not a regular file: ${filename}`);
  }
}

async function readBuildFile(distDirectory, relativePath, label, encoding) {
  const filename = await requireBuildFile(distDirectory, relativePath, label);
  return readFile(filename, encoding);
}

async function requireBuildFile(distDirectory, relativePath, label) {
  const parts = relativePath.split('/');
  let currentPath = distDirectory;
  for (let index = 0; index < parts.length; index += 1) {
    currentPath = path.join(currentPath, parts[index]);
    const stats = await lstat(currentPath).catch(() => null);
    if (!stats || stats.isSymbolicLink()) {
      throw new Error(`${label} is missing or contains a symbolic link: ${currentPath}`);
    }
    if (index < parts.length - 1 && !stats.isDirectory()) {
      throw new Error(`${label} contains a non-directory path component: ${currentPath}`);
    }
    if (index === parts.length - 1 && !stats.isFile()) {
      throw new Error(`${label} is not a regular file: ${currentPath}`);
    }
  }
  return currentPath;
}

async function pathExists(filename) {
  return (await lstat(filename).catch(() => null)) !== null;
}

function digest(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
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
