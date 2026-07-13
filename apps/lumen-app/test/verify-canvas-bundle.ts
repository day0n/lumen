import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const distDirectory = new URL('../dist/', import.meta.url);
const assetsDirectory = new URL('../dist/assets/', import.meta.url);
const assetNames = await readdir(assetsDirectory);
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

console.log('Canvas bundle boundary verified.');

async function readAsset(name: string) {
  return readFile(new URL(name, assetsDirectory), 'utf8');
}

async function readSourceMap(name: string): Promise<{ sources: string[] }> {
  return JSON.parse(await readAsset(name)) as { sources: string[] };
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
