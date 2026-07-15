import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

interface ManifestChunk {
  css?: string[];
  file: string;
  imports?: string[];
  isEntry?: boolean;
}

const distDirectory = new URL('../dist/', import.meta.url);
const manifest = JSON.parse(
  await readFile(new URL('.vite/manifest.json', distDirectory), 'utf8'),
) as Record<string, ManifestChunk>;
const documents = [
  { entry: 'not-found.html', filename: 'not-found.html', lang: 'en', marker: 'en' },
  {
    entry: 'not-found-zh.html',
    filename: 'not-found-zh.html',
    lang: 'zh-CN',
    marker: 'zh',
  },
] as const;
const forbiddenSources = [
  '/lumen-studio/',
  '/providers/',
  '/features/auth/',
  '/features/landing/',
  '/lib/api-client',
  '/node_modules/@clerk/',
  '/node_modules/@mantine/',
  '/node_modules/@sentry/',
  '/node_modules/@tanstack/',
  '/node_modules/react/',
  '/node_modules/react-dom/',
];

for (const document of documents) {
  const html = await readFile(new URL(document.filename, distDirectory), 'utf8');
  assert.match(html, new RegExp(`<html lang="${document.lang}">`));
  assert.match(html, new RegExp(`data-lumen-static-not-found="${document.marker}"`));
  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(html, /class="not-found-content"/);
  assert.ok(html.length > 1_500, `${document.filename} does not contain a static recovery page`);

  const entry = manifest[document.entry];
  assert.ok(entry?.isEntry, `${document.entry} is not a Vite page entry`);
  const closure = collectManifestClosure(document.entry);
  let javascriptBytes = 0;
  let cssBytes = 0;

  for (const key of closure) {
    const chunk = manifest[key];
    assert.ok(chunk, `Not-found manifest dependency is missing: ${key}`);
    javascriptBytes += (await stat(new URL(chunk.file, distDirectory))).size;
    assert.doesNotMatch(chunk.file, /(?:react|clerk|router|sentry|app)-vendor/);
    for (const filename of chunk.css ?? []) {
      assert.doesNotMatch(filename, /app-[A-Za-z0-9_-]+\.css$/, `${document.entry} loads app CSS`);
      cssBytes += (await stat(new URL(filename, distDirectory))).size;
    }

    const sourceMap = JSON.parse(
      await readFile(new URL(`${chunk.file}.map`, distDirectory), 'utf8'),
    ) as { sources?: string[] };
    for (const source of sourceMap.sources ?? []) {
      const normalizedSource = source.replace(/\\/g, '/');
      for (const forbidden of forbiddenSources) {
        assert.equal(
          normalizedSource.includes(forbidden),
          false,
          `Not-found initial bundle includes ${forbidden} through ${chunk.file}`,
        );
      }
    }
  }

  assert.ok(javascriptBytes < 5_000, `${document.entry} JavaScript exceeded 5KB`);
  assert.ok(cssBytes < 10_000, `${document.entry} CSS exceeded 10KB`);
}

console.log('Static not-found bundle boundaries verified.');

function collectManifestClosure(root: string) {
  const visited = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const key = queue.shift();
    if (!key || visited.has(key)) continue;
    visited.add(key);
    const chunk = manifest[key];
    assert.ok(chunk, `Not-found manifest dependency is missing: ${key}`);
    queue.push(...(chunk.imports ?? []));
  }
  return visited;
}
