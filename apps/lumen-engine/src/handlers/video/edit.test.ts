import assert from 'node:assert/strict';
import test from 'node:test';

import { type PreparedClip, buildFilterComplex } from './edit.js';

test('composition mix keeps source audio primary when BGM is present', () => {
  const filter = buildFilterComplex({
    clips: [
      testClip({
        hasAudio: true,
        volume: 1,
      }),
    ],
    width: 720,
    height: 1280,
    fps: 30,
    bgmInputIndex: 1,
    settings: {
      timeline: {
        bgmVolume: 0.8,
      },
    },
  });

  assert.match(filter, /volume=0\.32/);
  assert.match(filter, /asplit=2\[acatForDucking\]\[acatForMix\]/);
  assert.match(filter, /sidechaincompress=/);
  assert.match(
    filter,
    /\[acatForMix\]\[bgm\]amix=inputs=2:duration=first:dropout_transition=0:normalize=0/,
  );
});

test('composition mix lets BGM stay full when source clips have no audio', () => {
  const filter = buildFilterComplex({
    clips: [
      testClip({
        hasAudio: false,
        volume: 1,
      }),
    ],
    width: 720,
    height: 1280,
    fps: 30,
    bgmInputIndex: 1,
    settings: {
      timeline: {
        bgmVolume: 0.8,
      },
    },
  });

  assert.match(filter, /volume=0\.8/);
  assert.doesNotMatch(filter, /sidechaincompress=/);
});

function testClip(patch: Partial<PreparedClip> = {}): PreparedClip {
  return {
    index: 0,
    inputPath: '/tmp/clip.mp4',
    sourceUrl: 'https://cdn.example.com/clip.mp4',
    start: 0,
    duration: 5,
    volume: 1,
    hasAudio: true,
    ...patch,
  };
}
