import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';

interface ManifestChunk {
  assets?: string[];
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
  { entry: 'auth.html', filename: 'auth.html', lang: 'en', marker: 'en' },
  { entry: 'auth-zh.html', filename: 'auth-zh.html', lang: 'zh-CN', marker: 'zh' },
] as const;
const forbiddenSources = [
  '/lumen-studio/',
  '/providers/app-providers',
  '/lib/api-client',
  '/src/i18n/messages',
  '/packages/shared/src/i18n/messages',
  '/node_modules/@mantine/',
  '/node_modules/@sentry/',
  '/node_modules/@tanstack/',
  '/node_modules/@xyflow/',
  '/node_modules/motion/',
];
const closures = new Map<string, Set<string>>();

for (const document of documents) {
  const html = await readFile(new URL(document.filename, distDirectory), 'utf8');
  assert.match(html, new RegExp(`<html lang="${document.lang}">`));
  assert.match(html, new RegExp(`data-lumen-static-auth="${document.marker}"`));
  assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
  assert.match(html, /class="auth-loading"/);
  assert.ok(html.length > 2_000, `${document.filename} does not contain a static loading shell`);

  const entry = manifest[document.entry];
  assert.ok(entry?.isEntry, `${document.entry} is not a Vite page entry`);
  closures.set(document.entry, collectManifestClosure(document.entry));
}

const englishFiles = new Set(
  [...(closures.get('auth.html') ?? [])].map((key) => manifest[key]?.file).filter(Boolean),
);
assert.equal(
  [...englishFiles].some((filename) => filename?.includes('clerk-localizations-')),
  false,
  'English auth must not load the Chinese localization chunk',
);

for (const [entryKey, closure] of closures) {
  let javascriptBytes = 0;
  let cssBytes = 0;
  for (const key of closure) {
    const chunk = manifest[key];
    assert.ok(chunk, `Auth manifest dependency is missing: ${key}`);
    javascriptBytes += (await stat(new URL(chunk.file, distDirectory))).size;
    for (const filename of chunk.css ?? []) {
      assert.doesNotMatch(filename, /app-[A-Za-z0-9_-]+\.css$/, `${entryKey} loads app CSS`);
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
          `Auth initial bundle includes ${forbidden} through ${chunk.file}`,
        );
      }
    }
  }
  assert.ok(javascriptBytes < 500_000, `${entryKey} JavaScript exceeded 500KB: ${javascriptBytes}`);
  assert.ok(cssBytes < 20_000, `${entryKey} CSS exceeded 20KB: ${cssBytes}`);
}

console.log('Static auth bundle boundaries verified.');

function collectManifestClosure(root: string) {
  const visited = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const key = queue.shift();
    if (!key || visited.has(key)) continue;
    visited.add(key);
    const chunk = manifest[key];
    assert.ok(chunk, `Auth manifest dependency is missing: ${key}`);
    queue.push(...(chunk.imports ?? []));
  }
  return visited;
}
