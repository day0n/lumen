import assert from 'node:assert/strict';
import test from 'node:test';

import { readMessageObjectArray, translate } from '../src/i18n/messages.ts';
import { localeFromAcceptLanguage, localePath, stripLocalePrefix } from '../src/i18n/routing.ts';

test('locale routing preserves query strings and hashes', () => {
  assert.equal(localePath('/home?tab=recent#top', 'zh'), '/zh/home?tab=recent#top');
  assert.equal(localePath('/zh/home?tab=recent', 'en'), '/home?tab=recent');
  assert.equal(stripLocalePrefix('/zh/canvas/new'), '/canvas/new');
});

test('accept-language uses quality order for supported locales', () => {
  assert.equal(localeFromAcceptLanguage('en;q=0.7,zh-CN;q=0.9'), 'zh');
  assert.equal(localeFromAcceptLanguage('fr-FR,de;q=0.8'), null);
});

test('messages preserve interpolation and structured arrays', () => {
  assert.equal(translate('zh', 'home.featuredGoTo', { title: '示例' }), '切换到 示例');
  const quickActions = readMessageObjectArray<{ label: string; prompt: string }>(
    'en',
    'home.quickActions',
  );
  assert.equal(quickActions.length, 3);
  assert.equal(typeof quickActions[0]?.prompt, 'string');
});
