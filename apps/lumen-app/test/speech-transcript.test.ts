import assert from 'node:assert/strict';
import test from 'node:test';

import { appendSpeechTranscript } from '../src/hooks/use-speech-to-text.ts';

test('appendSpeechTranscript separates adjacent phrases', () => {
  assert.equal(
    appendSpeechTranscript('Create a product video', 'with a summer theme'),
    'Create a product video with a summer theme',
  );
});

test('appendSpeechTranscript does not add a space after terminal punctuation', () => {
  assert.equal(
    appendSpeechTranscript('先生成一个版本。', '再调整节奏'),
    '先生成一个版本。再调整节奏',
  );
  assert.equal(appendSpeechTranscript('Try this!', 'Now'), 'Try this!Now');
});

test('appendSpeechTranscript trims the join boundary', () => {
  assert.equal(appendSpeechTranscript('  hello   ', 'world'), 'hello world');
  assert.equal(appendSpeechTranscript('', '  first phrase'), 'first phrase');
});
