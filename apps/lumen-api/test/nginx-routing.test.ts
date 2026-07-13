import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const nginxPath = path.join(repositoryRoot, 'infra/nginx/lumenstudio.tech.conf');
const fallbackLocation = '@lumen_studio_api_read_fallback';
const projectsStudioPassthroughLocation = '@lumen_projects_studio_passthrough';

const forwardedRequestHeaders = [
  'proxy_set_header Connection "";',
  'proxy_set_header Host $host;',
  'proxy_set_header X-Real-IP $remote_addr;',
  'proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;',
  'proxy_set_header X-Forwarded-Proto $scheme;',
  'proxy_set_header Cookie $http_cookie;',
  'proxy_set_header Authorization $http_authorization;',
  'proxy_set_header Origin $http_origin;',
  'proxy_set_header sentry-trace $http_sentry_trace;',
  'proxy_set_header baggage $http_baggage;',
  'proxy_set_header CF-Ray $http_cf_ray;',
  'proxy_set_header X-Request-ID $request_id;',
];

const homeReadLocations = ['= /api/home/featured', '= /api/home/templates'];
const notificationReadLocation = '= /api/notifications/official';
const notificationWriteLocation = '^~ /api/notifications/official/';
const projectsEntryLocation = '= /api/projects';
const legacyApiReadLocations = [...homeReadLocations, '= /api/me'];
const apiReadLocations = [...legacyApiReadLocations, notificationReadLocation];
const apiProxyLocations = [...apiReadLocations, notificationWriteLocation, projectsEntryLocation];

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

test('sends only the intended API reads and notification writes to the API', async () => {
  const source = await readFile(nginxPath, 'utf8');
  const server = extractBlock(source, 'server');
  const apiLocations = locationDeclarations(server).filter((location) => location.includes('/api'));

  assert.deepEqual(apiLocations.sort(), apiProxyLocations.toSorted());
  assert.equal(countOccurrences(server, 'proxy_pass http://127.0.0.1:3003;'), 6);

  for (const location of apiReadLocations) {
    const block = extractBlock(server, `location ${location}`);
    assertContainsAll(block, [
      `error_page 500 502 503 504 = ${fallbackLocation};`,
      'if ($request_method !~ ^(GET|HEAD)$)',
      'proxy_pass http://127.0.0.1:3003;',
      'proxy_http_version 1.1;',
      'proxy_intercept_errors on;',
      'proxy_connect_timeout 1s;',
      'proxy_send_timeout 5s;',
      'proxy_read_timeout 5s;',
      'proxy_hide_header Cache-Control;',
      ...forwardedRequestHeaders,
    ]);
    assert.equal(countOccurrences(block, 'proxy_pass http://127.0.0.1:3003;'), 1);
  }

  for (const location of legacyApiReadLocations) {
    const block = extractBlock(server, `location ${location}`);
    assertContainsAll(block, [`error_page 418 = ${fallbackLocation};`, 'return 418;']);
  }

  for (const location of homeReadLocations) {
    assert.ok(
      extractBlock(server, `location ${location}`).includes(
        'add_header Cache-Control "no-store" always;',
      ),
    );
  }

  const currentUser = extractBlock(server, 'location = /api/me');
  assert.ok(currentUser.includes(`error_page 404 = ${fallbackLocation};`));
  assert.doesNotMatch(currentUser, /error_page[^\n]*(?:401|403)/);
  assert.ok(currentUser.includes('add_header Cache-Control "private, no-store" always;'));

  const notificationRead = extractBlock(server, 'location = /api/notifications/official');
  assertContainsAll(notificationRead, [
    `error_page 404 = ${fallbackLocation};`,
    `error_page 500 502 503 504 = ${fallbackLocation};`,
    'return 405;',
    'add_header Cache-Control "private, no-store" always;',
  ]);
  assert.equal(countOccurrences(notificationRead, 'error_page'), 2);
  assert.doesNotMatch(notificationRead, /error_page[^\n]*(?:401|403|418)/);
});

test('sends only project GET and HEAD requests to the API read route', async () => {
  const source = await readFile(nginxPath, 'utf8');
  const server = extractBlock(source, 'server');
  const projectsEntry = extractBlock(server, `location ${projectsEntryLocation}`);

  assertContainsAll(projectsEntry, [
    `error_page 418 = ${projectsStudioPassthroughLocation};`,
    `error_page 404 = ${fallbackLocation};`,
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
    'add_header Cache-Control "private, no-store" always;',
    ...forwardedRequestHeaders,
  ]);
  assert.equal(countOccurrences(projectsEntry, 'error_page'), 3);
  assert.equal(countOccurrences(projectsEntry, 'proxy_pass'), 1);
  assert.doesNotMatch(projectsEntry, /error_page[^\n]*(?:400|401|403)/);
  assert.doesNotMatch(projectsEntry, /proxy_pass\s+http:\/\/127\.0\.0\.1:3003\//);
  assert.doesNotMatch(
    projectsEntry,
    /\brewrite\b|\$request_uri|proxy_pass_request_body|proxy_set_body/,
  );

  const projectsStudio = extractBlock(server, `location ${projectsStudioPassthroughLocation}`);
  assertContainsAll(projectsStudio, [
    'proxy_pass http://127.0.0.1:3000;',
    'proxy_http_version 1.1;',
    'proxy_intercept_errors off;',
    'proxy_hide_header Cache-Control;',
    'add_header Cache-Control "private, no-store" always;',
    ...forwardedRequestHeaders,
  ]);
  assert.equal(countOccurrences(projectsStudio, 'proxy_pass'), 1);
  assert.doesNotMatch(projectsStudio, /\berror_page\b|127\.0\.0\.1:3003/);
  assert.doesNotMatch(projectsStudio, /proxy_pass\s+http:\/\/127\.0\.0\.1:3000\//);
  assert.doesNotMatch(
    projectsStudio,
    /\brewrite\b|\$request_uri|proxy_pass_request_body|proxy_set_body|proxy_(?:connect|send|read)_timeout/,
  );

  const readFallback = extractBlock(server, `location ${fallbackLocation}`);
  assert.doesNotMatch(readFallback, /\berror_page\b/);
});

test('keeps notification writes fail-closed without any Studio fallback', async () => {
  const source = await readFile(nginxPath, 'utf8');
  const server = extractBlock(source, 'server');
  const notificationWrite = extractBlock(server, 'location ^~ /api/notifications/official/');

  assertContainsAll(notificationWrite, [
    'if ($request_method != POST)',
    'return 405;',
    'proxy_pass http://127.0.0.1:3003;',
    'proxy_http_version 1.1;',
    'proxy_intercept_errors off;',
    'proxy_connect_timeout 1s;',
    'proxy_send_timeout 5s;',
    'proxy_read_timeout 5s;',
    'proxy_hide_header Cache-Control;',
    'add_header Cache-Control "private, no-store" always;',
    ...forwardedRequestHeaders,
  ]);
  assert.equal(countOccurrences(notificationWrite, 'proxy_pass http://127.0.0.1:3003;'), 1);
  assert.doesNotMatch(
    notificationWrite,
    /\berror_page\b|@lumen_studio_api_read_fallback|proxy_intercept_errors\s+on|\brewrite\b/,
  );
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
    'add_header Cache-Control "private, no-store" always;',
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
