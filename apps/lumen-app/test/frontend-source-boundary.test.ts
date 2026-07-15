import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const buildConfigurationFiles = [
  '../vite.config.ts',
  '../tsconfig.json',
  '../tailwind.config.ts',
  '../src/styles/app.css',
];

test('the static frontend build owns its source and configuration', async () => {
  for (const relativePath of buildConfigurationFiles) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    assert.doesNotMatch(source, /lumen-studio/, `${relativePath} depends on the legacy runtime`);
  }

  const viteConfig = await readFile(new URL('../vite.config.ts', import.meta.url), 'utf8');
  const packageManifest = await readFile(new URL('../package.json', import.meta.url), 'utf8');
  const tsconfig = await readFile(new URL('../tsconfig.json', import.meta.url), 'utf8');
  const tailwindConfig = await readFile(new URL('../tailwind.config.ts', import.meta.url), 'utf8');

  assert.match(viteConfig, /find: '@', replacement: path\.resolve\(__dirname, 'src'\)/);
  assert.match(viteConfig, /LUMEN_REQUIRE_PUBLIC_CONFIG/);
  assert.match(viteConfig, /'\/v1\/agent': 'http:\/\/localhost:3001'/);
  assert.doesNotMatch(packageManifest, /@lumen\/db/);
  assert.match(tsconfig, /"@\/\*": \["\.\/src\/\*"\]/);
  assert.match(tailwindConfig, /content: \['\.\/src\/\*\*\/\*\.\{ts,tsx,html\}'\]/);
});
