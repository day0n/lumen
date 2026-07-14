import assert from 'node:assert/strict';
import test from 'node:test';

import { isSafeReleasePath, validateReleasePath } from '../src/release-path.mjs';

test('accepts canonical relative release object paths', () => {
  for (const filename of [
    'app/index.html',
    'share/index.html',
    'assets/app-abc123.js',
    'assets/app.js.br',
    'home-posters/你好.webp',
  ]) {
    assert.equal(validateReleasePath(filename), filename);
    assert.equal(isSafeReleasePath(filename), true);
  }
});

test('rejects paths that cannot be served as the same immutable object key', () => {
  for (const filename of [
    '',
    '/assets/app.js',
    'assets//app.js',
    'assets/./app.js',
    'assets/../app.js',
    'assets/.hidden.js',
    'assets/app.js.map',
    'assets/app?old.js',
    'assets/app#old.js',
    'assets/app\\old.js',
    'assets/%2f.js',
    'assets/%2E.js',
    'assets/%5c.js',
    'assets/%00.js',
    'assets/control\u0000.js',
  ]) {
    assert.throws(() => validateReleasePath(filename), /unsafe release path/);
    assert.equal(isSafeReleasePath(filename), false);
  }
});
