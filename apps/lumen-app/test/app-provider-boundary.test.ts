import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('app root excludes providers without runtime consumers', async () => {
  const source = await readFile(
    new URL('../src/providers/app-providers.tsx', import.meta.url),
    'utf8',
  );

  for (const dependency of ['@tanstack/react-query', 'jotai', '@mantine/core']) {
    assert.doesNotMatch(source, new RegExp(dependency.replace('/', '\\/')));
  }

  for (const provider of ['QueryClientProvider', 'JotaiProvider', 'MantineProvider']) {
    assert.doesNotMatch(source, new RegExp(provider));
  }
});

test('the auth bridge clears private API data after a loaded session signs out', async () => {
  const source = await readFile(
    new URL('../src/providers/app-providers.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /if \(isLoaded && !isSignedIn\) clearPrivateApiMemoryCache\(\);/);
});

test('router vendor chunk excludes the unused query runtime', async () => {
  const source = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');

  assert.match(source, /return 'router-vendor'/);
  assert.doesNotMatch(source, /return 'query-vendor'/);
  assert.doesNotMatch(source, /router-query-vendor/);
});

test('the static app keeps native controls in the dark color scheme', async () => {
  const source = await readFile(new URL('../src/styles/app.css', import.meta.url), 'utf8');
  assert.match(source, /color-scheme: dark/);
});

test('the static app stylesheet excludes unused component library styles', async () => {
  const source = await readFile(new URL('../src/styles/app.css', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /@mantine\/core\/styles\.css/);
});
