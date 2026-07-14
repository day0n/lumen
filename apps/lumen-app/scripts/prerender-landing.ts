import { readFile, writeFile } from 'node:fs/promises';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { LandingRoot } from '../src/features/landing/LandingRoot';
import type { Locale } from '../src/i18n/routing';

const ROOT_MARKER = '<div id="root"><!--lumen-static-landing--></div>';
const distDirectory = new URL('../dist/', import.meta.url);
const documents: { filename: string; locale: Locale }[] = [
  { filename: 'landing.html', locale: 'en' },
  { filename: 'landing-zh.html', locale: 'zh' },
];

for (const document of documents) {
  const documentUrl = new URL(document.filename, distDirectory);
  const html = await readFile(documentUrl, 'utf8');
  if (!html.includes(ROOT_MARKER)) {
    throw new Error(`${document.filename} is missing the static landing marker`);
  }

  const markup = renderToString(createElement(LandingRoot, { locale: document.locale }));
  if (!markup.includes('<h1')) {
    throw new Error(`${document.filename} did not render the landing heading`);
  }

  const staticRoot = `<div id="root" data-lumen-prerendered="true" data-lumen-static-landing="${document.locale}">${markup}</div>`;
  await writeFile(documentUrl, html.replace(ROOT_MARKER, staticRoot));
}
