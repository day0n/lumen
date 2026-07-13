import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  isTemplateVideoInViewport,
  requestTemplateVideoPlayback,
} from '../src/features/home/template-video.ts';

test('template video visibility requires a viewport intersection', () => {
  assert.equal(
    isTemplateVideoInViewport({ bottom: 200, left: 20, right: 220, top: 20 }, 1280, 720),
    true,
  );
  assert.equal(
    isTemplateVideoInViewport({ bottom: -1, left: 20, right: 220, top: -200 }, 1280, 720),
    false,
  );
  assert.equal(
    isTemplateVideoInViewport({ bottom: 920, left: 20, right: 220, top: 721 }, 1280, 720),
    false,
  );
});

test('template video playback absorbs rejected autoplay attempts', async () => {
  await assert.doesNotReject(
    requestTemplateVideoPlayback({
      play: async () => {
        throw new Error('playback blocked');
      },
    }),
  );

  await assert.doesNotReject(
    requestTemplateVideoPlayback({
      play: () => {
        throw new Error('playback unavailable');
      },
    }),
  );
});

test('template videos defer loading until the viewport observers run', async () => {
  const source = await readFile(
    new URL('../src/features/home/TemplateRail.tsx', import.meta.url),
    'utf8',
  );

  assert.match(source, /preload="none"/);
  assert.doesNotMatch(source, /\bautoPlay\b/);
  assert.match(source, /rootMargin: '160px 0px'/);
  assert.match(source, /playbackObserver\.disconnect\(\)/);
  assert.match(source, /prefers-reduced-motion: reduce/);
  assert.match(source, /handleDocumentVisibility = \(\) => syncPlayback\(visible\)/);
  assert.match(source, /if \(!Observer\) \{\s+const syncFallbackPlayback/);
});
