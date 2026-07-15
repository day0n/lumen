import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

test('not-found documents provide localized static recovery pages without indexing', async () => {
  for (const definition of [
    {
      filename: 'not-found.html',
      homePath: '/',
      lang: 'en',
      marker: 'en',
      title: 'Page not found — Lumen',
    },
    {
      filename: 'not-found-zh.html',
      homePath: '/zh',
      lang: 'zh-CN',
      marker: 'zh',
      title: '页面不存在 — Lumen',
    },
  ]) {
    const html = await readFile(new URL(`../${definition.filename}`, import.meta.url), 'utf8');
    assert.match(html, new RegExp(`<html lang="${definition.lang}">`));
    assert.match(html, new RegExp(`<title>${definition.title}</title>`));
    assert.match(html, new RegExp(`data-lumen-static-not-found="${definition.marker}"`));
    assert.match(html, /<meta name="robots" content="noindex, nofollow"/);
    assert.match(html, /class="not-found-content"/);
    assert.match(html, /class="not-found-code"[^>]*>404</);
    assert.match(html, new RegExp(`class="not-found-primary" href="${definition.homePath}"`));
    assert.match(html, /class="not-found-secondary" href="\/app\/home"/);
  }
});
