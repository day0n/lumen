import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const appHomeSources = [
  '../src/features/home/HomePage.tsx',
  '../src/features/home/FeaturedCarousel.tsx',
  '../src/features/home/Hero.tsx',
  '../src/features/home/TemplateRail.tsx',
  '../src/features/home/home-icons.tsx',
  '../src/components/voice/VoiceInputControl.tsx',
  '../src/hooks/use-speech-to-text.ts',
];

const forbiddenHomeRuntimeImports = new Set(['motion/react', '@tabler/icons-react']);

test('static home sources stay inside the app package boundary', async () => {
  for (const relativePath of appHomeSources) {
    const source = await readFile(new URL(relativePath, import.meta.url), 'utf8');
    const imports = Array.from(
      source.matchAll(/(?:from\s+|import\()\s*['"]([^'"]+)['"]/g),
      (match) => match[1],
    );

    assert.equal(
      imports.some(
        (specifier) =>
          specifier.startsWith('@/') ||
          specifier.startsWith('next/') ||
          specifier.includes('lumen-studio'),
      ),
      false,
      `${relativePath} crosses the static app source boundary`,
    );
    assert.equal(
      imports.some((specifier) => forbiddenHomeRuntimeImports.has(specifier)),
      false,
      `${relativePath} pulls an animation or icon runtime into the home route`,
    );
  }
});

test('home route and warmup load the app-owned page', async () => {
  const route = await readFile(new URL('../src/routes/home.tsx', import.meta.url), 'utf8');
  const warmup = await readFile(new URL('../src/lib/app-warmup.ts', import.meta.url), 'utf8');

  assert.match(route, /import\(['"]\.\.\/features\/home\/HomePage['"]\)/);
  assert.match(warmup, /import\(['"]\.\.\/features\/home\/HomePage['"]\)/);
  assert.doesNotMatch(warmup, /\/api\/projects\?limit=3/);
});
