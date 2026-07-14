import assert from 'node:assert/strict';
import test from 'node:test';
import { resolveReleaseAssetUrl } from '../src/lib/release-asset-url';

const RELEASE_BASE = '/_static/releases/0123456789abcdef0123456789abcdef01234567/';

test('pins approved public assets to their frontend release', () => {
  assert.equal(
    resolveReleaseAssetUrl('/material-showcase/item.webp', RELEASE_BASE),
    `${RELEASE_BASE}material-showcase/item.webp`,
  );
  assert.equal(
    resolveReleaseAssetUrl('/app/home-posters/selected/poster.webp', RELEASE_BASE),
    `${RELEASE_BASE}home-posters/selected/poster.webp`,
  );
  assert.equal(
    resolveReleaseAssetUrl('/home-templates/covers/template.webp?size=small', RELEASE_BASE),
    `${RELEASE_BASE}home-templates/covers/template.webp?size=small`,
  );
  assert.equal(
    resolveReleaseAssetUrl(
      'https://lumenstudio.tech/home-templates/covers/template.webp?v=1',
      RELEASE_BASE,
      'https://lumenstudio.tech',
    ),
    `${RELEASE_BASE}home-templates/covers/template.webp?v=1`,
  );
});

test('leaves API, external and origin-mode URLs unchanged', () => {
  for (const value of [
    '/api/home/templates',
    'https://cdn.example.test/template.webp',
    'data:image/png;base64,abc',
  ]) {
    assert.equal(resolveReleaseAssetUrl(value, RELEASE_BASE), value);
    assert.equal(resolveReleaseAssetUrl(value, ''), value);
  }
});
