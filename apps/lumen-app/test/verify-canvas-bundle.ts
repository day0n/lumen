import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const distDirectory = new URL('../dist/', import.meta.url);
const assetsDirectory = new URL('../dist/assets/', import.meta.url);
const assetNames = await readdir(assetsDirectory);
const manifest = JSON.parse(
  await readFile(new URL('.vite/manifest.json', distDirectory), 'utf8'),
) as Record<string, ManifestChunk>;
const homeParents = new Map<string, string>();
const indexHtml = await readFile(new URL('index.html', distDirectory), 'utf8');
const htmlAssets = readHtmlAssets(indexHtml);
const initialJavaScript = htmlAssets
  .filter(
    (asset) =>
      asset.name.endsWith('.js') &&
      (asset.tag === 'script' || (asset.tag === 'link' && asset.rel === 'modulepreload')),
  )
  .map((asset) => asset.name);
const initialStyles = htmlAssets
  .filter(
    (asset) => asset.tag === 'link' && asset.rel === 'stylesheet' && asset.name.endsWith('.css'),
  )
  .map((asset) => asset.name);

assert.ok(initialJavaScript.length > 0, 'index.html has no initial JavaScript assets');
assert.ok(initialStyles.length > 0, 'index.html has no initial stylesheet assets');

const initialSourceMaps = await Promise.all(
  initialJavaScript.map((name) => readSourceMap(`${name}.map`)),
);
const initialCss = (await Promise.all(initialStyles.map(readAsset))).join('\n');
const initialStyleSet = new Set(initialStyles);
const lazyCssAssets = assetNames.filter(
  (name) => name.endsWith('.css') && !initialStyleSet.has(name),
);
const lazyCss = await Promise.all(lazyCssAssets.map(readAsset));

const forbiddenInitialSources = [
  '/src/features/canvas/CanvasRoute.tsx',
  '/src/components/canvas/CanvasWorkbench.tsx',
  '/src/components/canvas/CanvasEntryLoader.tsx',
  '/src/components/canvas/CanvasDotLogo.tsx',
  '/src/components/canvas/CanvasRotatingLabel.tsx',
  '/src/components/canvas/canvas-entry-loader.ts',
  '/src/components/shell/NotificationsPopover.tsx',
];

const forbiddenInitialDependencies = [
  '/node_modules/motion/',
  '/node_modules/@tabler/icons-react/',
];

for (const suffix of forbiddenInitialSources) {
  assert.equal(
    initialSourceMaps.some((sourceMap) =>
      sourceMap.sources.some((source) => source.endsWith(suffix)),
    ),
    false,
    `${suffix} leaked into an initial JavaScript chunk`,
  );
}

for (const dependency of forbiddenInitialDependencies) {
  assert.equal(
    initialSourceMaps.some((sourceMap) =>
      sourceMap.sources.some((source) => source.includes(dependency)),
    ),
    false,
    `${dependency} leaked into an initial JavaScript chunk`,
  );
}

for (const asset of initialJavaScript) {
  assert.doesNotMatch(asset, /^(?:motion|icons)-vendor-/);
}

assert.doesNotMatch(initialCss, /--xy-edge-stroke-default/);
assert.doesNotMatch(initialCss, /(?:--mantine-|\.mantine-|data-mantine)/);
assert.ok(
  lazyCss.some((css) => css.includes('--xy-edge-stroke-default')),
  'ReactFlow styles were not emitted with a lazy chunk',
);

const allSourceMaps = await Promise.all(
  assetNames.filter((name) => name.endsWith('.js.map')).map(readSourceMap),
);
const canvasRouteSourceMaps = allSourceMaps.filter((sourceMap) =>
  sourceMap.sources.some((source) => source.endsWith('/src/features/canvas/CanvasRoute.tsx')),
);
assert.equal(canvasRouteSourceMaps.length, 1, 'CanvasRoute was not emitted in one lazy chunk');

const homeEntry = findManifestEntry('src/features/home/HomePage.tsx');
assert.equal(homeEntry.chunk.isDynamicEntry, true, 'HomePage is not emitted as a dynamic entry');
assert.ok(
  findReachableManifestKeys(
    Object.entries(manifest)
      .filter(([, chunk]) => chunk.isEntry)
      .map(([key]) => key),
    true,
  ).has(homeEntry.key),
  'HomePage dynamic entry is not reachable from the application entry',
);

const homeClosure = findReachableManifestKeys([homeEntry.key], false);
for (const key of homeClosure) {
  const chunk = readManifestChunk(key);
  assert.doesNotMatch(
    chunk.file.split('/').at(-1) ?? chunk.file,
    /^(?:motion|icons)-vendor-/,
    `Home route reaches forbidden vendor chunk through ${formatManifestPath(homeEntry.key, key)}`,
  );
  const sourceMap = await readDistSourceMap(`${chunk.file}.map`);
  for (const dependency of forbiddenInitialDependencies) {
    assert.equal(
      sourceMap.sources.some((source) => normalizePath(source).includes(dependency)),
      false,
      `Home route reaches ${dependency} through ${formatManifestPath(homeEntry.key, key)}`,
    );
  }
}

console.log('Static app bundle boundaries verified.');

type ManifestChunk = {
  file: string;
  src?: string;
  isEntry?: boolean;
  isDynamicEntry?: boolean;
  imports?: string[];
  dynamicImports?: string[];
};

async function readAsset(name: string) {
  return readFile(new URL(name, assetsDirectory), 'utf8');
}

async function readSourceMap(name: string): Promise<{ sources: string[] }> {
  return JSON.parse(await readAsset(name)) as { sources: string[] };
}

async function readDistSourceMap(name: string): Promise<{ sources: string[] }> {
  return JSON.parse(await readFile(new URL(name, distDirectory), 'utf8')) as {
    sources: string[];
  };
}

function findManifestEntry(sourceSuffix: string) {
  const matches = Object.entries(manifest).filter(([key, chunk]) =>
    normalizePath(chunk.src ?? key).endsWith(sourceSuffix),
  );
  assert.equal(matches.length, 1, `${sourceSuffix} was not emitted as exactly one manifest entry`);
  const [key, chunk] = matches[0] as [string, ManifestChunk];
  return { key, chunk };
}

function findReachableManifestKeys(roots: string[], includeDynamicImports: boolean) {
  const visited = new Set<string>();
  const queue = [...roots];

  homeParents.clear();
  while (queue.length > 0) {
    const key = queue.shift();
    if (!key || visited.has(key)) continue;
    visited.add(key);
    const chunk = readManifestChunk(key);
    const dependencies = [
      ...(chunk.imports ?? []),
      ...(includeDynamicImports ? (chunk.dynamicImports ?? []) : []),
    ];
    for (const dependency of dependencies) {
      if (!homeParents.has(dependency)) homeParents.set(dependency, key);
      queue.push(dependency);
    }
  }

  return visited;
}

function readManifestChunk(key: string) {
  const chunk = manifest[key];
  assert.ok(chunk, `Manifest dependency ${key} is missing`);
  return chunk;
}

function formatManifestPath(root: string, leaf: string) {
  const path = [leaf];
  let current = leaf;
  while (current !== root) {
    const parent = homeParents.get(current);
    if (!parent) break;
    path.push(parent);
    current = parent;
  }
  return path
    .reverse()
    .map((key) => readManifestChunk(key).file)
    .join(' -> ');
}

function normalizePath(value: string) {
  return value.replace(/\\/g, '/');
}

function readHtmlAssets(html: string) {
  return Array.from(html.matchAll(/<(script|link)\b([^>]*)>/g), (match) => {
    const attributes = Object.fromEntries(
      Array.from(match[2]?.matchAll(/([\w:-]+)(?:="([^"]*)")?/g) ?? [], (attribute) => [
        attribute[1],
        attribute[2] ?? '',
      ]),
    );
    const url = attributes.src || attributes.href || '';
    const assetMarker = '/assets/';
    const assetIndex = url.indexOf(assetMarker);
    const name = assetIndex >= 0 ? url.slice(assetIndex + assetMarker.length).split(/[?#]/)[0] : '';
    return {
      name,
      rel: attributes.rel ?? '',
      tag: match[1] ?? '',
    };
  }).filter((asset) => asset.name);
}
