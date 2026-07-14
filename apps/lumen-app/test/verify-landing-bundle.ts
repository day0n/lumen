import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

interface ManifestChunk {
  file: string;
  imports?: string[];
  isEntry?: boolean;
}

const distDirectory = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL('.vite/manifest.json', distDirectory), 'utf8'),
) as Record<string, ManifestChunk>;
const documents = [
  {
    entry: 'landing.html',
    filename: 'landing.html',
    locale: 'en',
    title: 'Lumen — Turn products into videos that sell',
  },
  {
    entry: 'landing-zh.html',
    filename: 'landing-zh.html',
    locale: 'zh',
    title: 'Lumen — 把商品变成爆款带货视频',
  },
] as const;

const forbiddenSources = [
  '/lumen-studio/',
  '/node_modules/@clerk/',
  '/node_modules/@mantine/',
  '/node_modules/@sentry/',
  '/node_modules/@tabler/icons-react/',
  '/node_modules/@tanstack/',
  '/node_modules/@xyflow/',
  '/node_modules/motion/',
];
const allInitialChunks = new Set<string>();

for (const document of documents) {
  const html = await readFile(new URL(document.filename, distDirectory), 'utf8');
  assert.match(html, new RegExp(`<title>${escapeRegExp(document.title)}</title>`));
  assert.match(html, new RegExp(`data-lumen-static-landing="${document.locale}"`));
  assert.match(html, /data-lumen-prerendered="true"/);
  assert.match(html, /<h1\b/);
  assert.ok(html.length > 10_000, `${document.filename} does not contain a complete static shell`);

  const entry = manifest[document.entry];
  assert.ok(entry?.isEntry, `${document.entry} is not a Vite page entry`);
  for (const key of collectManifestClosure(document.entry)) allInitialChunks.add(key);
}

let initialJavaScriptBytes = 0;
for (const key of allInitialChunks) {
  const chunk = manifest[key];
  assert.ok(chunk, `Landing manifest dependency is missing: ${key}`);
  assert.doesNotMatch(
    chunk.file,
    /(?:clerk|icons|motion|router|sentry|ui)-vendor-/,
    `Landing reaches forbidden vendor chunk ${chunk.file}`,
  );
  initialJavaScriptBytes += (await stat(new URL(chunk.file, distDirectory))).size;

  const sourceMap = JSON.parse(
    await readFile(new URL(`${chunk.file}.map`, distDirectory), 'utf8'),
  ) as { sources?: string[] };
  for (const source of sourceMap.sources ?? []) {
    const normalizedSource = source.replace(/\\/g, '/');
    for (const forbidden of forbiddenSources) {
      assert.equal(
        normalizedSource.includes(forbidden),
        false,
        `Landing initial bundle includes ${forbidden} through ${chunk.file}`,
      );
    }
  }
}

assert.ok(
  initialJavaScriptBytes < 250_000,
  `Landing initial JavaScript exceeded 250KB: ${initialJavaScriptBytes}`,
);

console.log('Static landing bundle boundaries verified.');

function collectManifestClosure(root: string) {
  const visited = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const key = queue.shift();
    if (!key || visited.has(key)) continue;
    visited.add(key);
    const chunk = manifest[key];
    assert.ok(chunk, `Landing manifest dependency is missing: ${key}`);
    queue.push(...(chunk.imports ?? []));
  }
  return visited;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
