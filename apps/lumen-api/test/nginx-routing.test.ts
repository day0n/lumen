import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const nginxPath = path.join(repositoryRoot, 'infra/nginx/lumenstudio.tech.conf');
const fallbackLocation = '@lumen_studio_home_read_fallback';

const forwardedRequestHeaders = [
  'proxy_set_header Connection "";',
  'proxy_set_header Host $host;',
  'proxy_set_header X-Real-IP $remote_addr;',
  'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
  'proxy_set_header X-Forwarded-Proto $scheme;',
  'proxy_set_header Cookie $http_cookie;',
  'proxy_set_header Authorization $http_authorization;',
  'proxy_set_header sentry-trace $http_sentry_trace;',
  'proxy_set_header baggage $http_baggage;',
  'proxy_set_header CF-Ray $http_cf_ray;',
  'proxy_set_header X-Request-ID $request_id;',
];

const homeReadLocations = ['= /api/home/featured', '= /api/home/templates'];

test('preserves the production listeners, TLS files, and existing upstream routes', async () => {
  const source = await readFile(nginxPath, 'utf8');
  const server = extractBlock(source, 'server');

  assertContainsAll(server, [
    'listen 80;',
    'listen 443 ssl;',
    'server_name lumenstudio.tech www.lumenstudio.tech;',
    'ssl_certificate /etc/ssl/certs/lumen.crt;',
    'ssl_certificate_key /etc/ssl/private/lumen.key;',
  ]);

  assertContainsAll(extractBlock(server, 'location /'), [
    'proxy_pass http://127.0.0.1:3000;',
    'proxy_http_version 1.1;',
    'proxy_set_header Host $host;',
    'proxy_set_header X-Real-IP $remote_addr;',
    'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    'proxy_set_header X-Forwarded-Proto $scheme;',
    'proxy_set_header Upgrade $http_upgrade;',
    'proxy_set_header Connection "upgrade";',
  ]);

  assertContainsAll(extractBlock(server, 'location /v1/agent/'), [
    'proxy_pass http://127.0.0.1:3001;',
    'proxy_http_version 1.1;',
    'proxy_set_header Host $host;',
    'proxy_set_header X-Real-IP $remote_addr;',
    'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
    'proxy_set_header X-Forwarded-Proto $scheme;',
  ]);

  assertContainsAll(extractBlock(server, 'location /ws/flow'), [
    'proxy_pass http://127.0.0.1:3000;',
    'proxy_http_version 1.1;',
    'proxy_set_header Upgrade $http_upgrade;',
    'proxy_set_header Connection "upgrade";',
    'proxy_set_header Host $host;',
    'proxy_set_header X-Real-IP $remote_addr;',
    'proxy_read_timeout 86400;',
  ]);
});

test('sends only the two exact GET and HEAD home reads to the API', async () => {
  const source = await readFile(nginxPath, 'utf8');
  const server = extractBlock(source, 'server');
  const apiLocations = locationDeclarations(server).filter((location) => location.includes('/api'));

  assert.deepEqual(apiLocations.sort(), homeReadLocations.toSorted());
  assert.equal(countOccurrences(server, 'proxy_pass http://127.0.0.1:3003;'), 2);

  for (const location of homeReadLocations) {
    const block = extractBlock(server, `location ${location}`);
    assertContainsAll(block, [
      `error_page 418 = ${fallbackLocation};`,
      `error_page 500 502 503 504 = ${fallbackLocation};`,
      'if ($request_method !~ ^(GET|HEAD)$)',
      'return 418;',
      'proxy_pass http://127.0.0.1:3003;',
      'proxy_http_version 1.1;',
      'proxy_intercept_errors on;',
      'proxy_connect_timeout 1s;',
      'proxy_send_timeout 5s;',
      'proxy_read_timeout 5s;',
      'proxy_hide_header Cache-Control;',
      'add_header Cache-Control "no-store" always;',
      ...forwardedRequestHeaders,
    ]);
    assert.equal(countOccurrences(block, 'proxy_pass http://127.0.0.1:3003;'), 1);
  }
});

test('falls back to Studio with the original URI and query on API read failures', async () => {
  const source = await readFile(nginxPath, 'utf8');
  const server = extractBlock(source, 'server');
  const fallback = extractBlock(server, `location ${fallbackLocation}`);

  assertContainsAll(fallback, [
    'proxy_pass http://127.0.0.1:3000;',
    'proxy_http_version 1.1;',
    'proxy_connect_timeout 1s;',
    'proxy_send_timeout 5s;',
    'proxy_read_timeout 5s;',
    'proxy_hide_header Cache-Control;',
    'add_header Cache-Control "no-store" always;',
    ...forwardedRequestHeaders,
  ]);
  assert.equal(countOccurrences(fallback, 'proxy_pass'), 1);
  assert.doesNotMatch(fallback, /proxy_pass\s+http:\/\/127\.0\.0\.1:3000\//);
  assert.doesNotMatch(fallback, /\brewrite\b|\$request_uri/);

  const root = extractBlock(server, 'location /');
  assert.match(root, /proxy_pass\s+http:\/\/127\.0\.0\.1:3000;/);
});

function extractBlock(source: string, declaration: string) {
  const declarationStart = source.indexOf(`${declaration} {`);
  assert.notEqual(declarationStart, -1, `${declaration} block is missing`);

  const openingBrace = source.indexOf('{', declarationStart);
  let depth = 0;
  for (let index = openingBrace; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1;
    if (source[index] !== '}') continue;

    depth -= 1;
    if (depth === 0) return source.slice(openingBrace + 1, index);
  }

  assert.fail(`${declaration} block is not closed`);
}

function locationDeclarations(source: string) {
  return Array.from(source.matchAll(/^\s*location\s+(.+?)\s*\{/gm), (match) => match[1].trim());
}

function assertContainsAll(source: string, directives: string[]) {
  for (const directive of directives) {
    assert.ok(source.includes(directive), `${directive} is missing`);
  }
}

function countOccurrences(source: string, value: string) {
  return source.split(value).length - 1;
}
