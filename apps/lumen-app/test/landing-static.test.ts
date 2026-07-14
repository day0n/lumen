import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { LandingRoot } from '../src/features/landing/LandingRoot';
import { INTRO_STRIPES } from '../src/features/landing/ParticleStory';
import { LANDING_MESSAGES } from '../src/features/landing/landing-i18n';
import { readAppAssetUrls } from '../src/features/landing/useHomeRoutePreload';
import { readMessageArray, translate } from '../src/i18n/messages';

test('landing renders meaningful English and Chinese HTML without a browser runtime', () => {
  const english = renderToString(createElement(LandingRoot, { locale: 'en' }));
  const chinese = renderToString(createElement(LandingRoot, { locale: 'zh' }));

  assert.match(english, /Turn products into/);
  assert.match(english, /videos that sell/);
  assert.match(english, /href="\/"/);
  assert.match(chinese, /把商品变成/);
  assert.match(chinese, /href="\/zh"/);
  assert.match(english, /<h1/);
  assert.match(chinese, /<h1/);
});

test('landing documents keep locale-specific canonical and alternate metadata', async () => {
  const english = await readFile(new URL('../landing.html', import.meta.url), 'utf8');
  const chinese = await readFile(new URL('../landing-zh.html', import.meta.url), 'utf8');

  assert.match(english, /<html lang="en">/);
  assert.match(english, /<link rel="canonical" href="https:\/\/lumenstudio\.tech\/"/);
  assert.match(chinese, /<html lang="zh-CN">/);
  assert.match(chinese, /<link rel="canonical" href="https:\/\/lumenstudio\.tech\/zh"/);
  for (const html of [english, chinese]) {
    assert.match(html, /hreflang="en"/);
    assert.match(html, /hreflang="zh"/);
    assert.match(html, /hreflang="x-default"/);
    assert.match(html, /<!--lumen-static-landing-->/);
  }
});

test('the isolated landing dictionary stays aligned with shared product copy', () => {
  for (const locale of ['en', 'zh'] as const) {
    for (const [key, value] of Object.entries(LANDING_MESSAGES[locale].text)) {
      assert.equal(value, translate(locale, key), `${locale}:${key}`);
    }
    for (const [key, value] of Object.entries(LANDING_MESSAGES[locale].arrays)) {
      assert.deepEqual(value, readMessageArray(locale, key), `${locale}:${key}`);
    }
  }
});

test('landing warmup discovers development and immutable app assets', () => {
  const release = '0123456789abcdef0123456789abcdef01234567';
  assert.deepEqual(
    readAppAssetUrls(`
      <script src="/app/assets/dev.js"></script>
      <link href="/_static/releases/${release}/assets/release.css" rel="stylesheet">
      <img src="/particle-masks/ignored.png">
    `),
    ['/app/assets/dev.js', `/_static/releases/${release}/assets/release.css`],
  );
});

test('prerendered stripe coordinates use stable fixed precision', () => {
  assert.equal(INTRO_STRIPES.length, 58);
  for (const stripe of INTRO_STRIPES) {
    assert.doesNotMatch(stripe.d, /\.\d{4,}/);
  }
});
