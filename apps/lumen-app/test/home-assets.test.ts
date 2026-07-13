import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import test from 'node:test';

const POSTER_NAMES = [
  'agent-chat-minimal',
  'agent-glass',
  'agent-pop',
  'hot-remix-collage',
  'material-archive',
  'material-mythic',
] as const;

test('fallback home posters stay compressed and app-owned', async () => {
  let totalBytes = 0;

  for (const name of POSTER_NAMES) {
    const file = new URL(`../public/home-posters/selected/${name}.webp`, import.meta.url);
    const metadata = await stat(file);
    assert.ok(metadata.size < 160 * 1024, `${name}.webp is too large`);
    totalBytes += metadata.size;
  }

  assert.ok(totalBytes < 700 * 1024, 'fallback home posters exceed the size budget');
});

test('featured fallback references the compressed posters', async () => {
  const source = await readFile(
    new URL('../src/features/home/FeaturedCarousel.tsx', import.meta.url),
    'utf8',
  );

  for (const name of POSTER_NAMES) {
    assert.match(source, new RegExp(`homePosterUrl\\('${name}\\.webp'\\)`));
  }
  assert.doesNotMatch(source, /\/home-posters\/selected\/[^'" ]+\.png/);
});
