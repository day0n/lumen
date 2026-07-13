import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('app links honor disabled intent preloading', async () => {
  const linkSource = await readFile(
    new URL('../src/compat/next-link.tsx', import.meta.url),
    'utf8',
  );
  const carouselSource = await readFile(
    new URL('../src/features/home/FeaturedCarousel.tsx', import.meta.url),
    'utf8',
  );

  assert.match(linkSource, /prefetch = true/);
  assert.match(linkSource, /if \(!prefetch\) return;/);
  assert.match(carouselSource, /<MotionLink[\s\S]*?prefetch=\{false\}/);
});
