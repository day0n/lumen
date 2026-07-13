import assert from 'node:assert/strict';
import test from 'node:test';

import { isCanvasShellRoute } from '../src/lib/app-shell-routes.ts';

test('canvas routes suppress the shared shell with or without the app base path', () => {
  assert.equal(isCanvasShellRoute('/app/canvas/new'), true);
  assert.equal(isCanvasShellRoute('/app/canvas/project-id'), true);
  assert.equal(isCanvasShellRoute('/canvas/new'), true);
  assert.equal(isCanvasShellRoute('/canvas/project-id'), true);
});

test('non-canvas routes keep the shared shell', () => {
  assert.equal(isCanvasShellRoute('/app/home'), false);
  assert.equal(isCanvasShellRoute('/app/projects'), false);
  assert.equal(isCanvasShellRoute('/canvas'), false);
});
