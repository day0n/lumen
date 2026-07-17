import assert from 'node:assert/strict';
import test from 'node:test';

import { toAppPath, toRouterPath } from '../src/lib/path-map.ts';

test('localized product paths stay inside the static app', () => {
  assert.equal(toAppPath('/zh/canvas/new?agent=chat'), '/app/canvas/new?agent=chat');
  assert.equal(toAppPath('/zh/materials'), '/app/materials');
  assert.equal(toAppPath('/zh/hot-videos'), '/app/hot-videos');
});

test('the retired dashboard path opens the app home', () => {
  assert.equal(toAppPath('/dashboard'), '/app/home');
  assert.deepEqual(toRouterPath('/dashboard'), { to: '/home', search: {} });
});

test('non-app and external paths remain outside the app router', () => {
  assert.equal(
    toAppPath('/sign-in?redirect_url=%2Fapp%2Fhome'),
    '/sign-in?redirect_url=%2Fapp%2Fhome',
  );
  assert.equal(toAppPath('https://example.com/resource'), 'https://example.com/resource');
  assert.equal(toRouterPath('/sign-in'), null);
});
