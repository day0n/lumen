import { pathToFileURL } from 'node:url';

const FULL_RELEASE_PATTERN = /^[0-9a-f]{40}$/;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;
const SHARE_ID = '00000000000000000000000000000000';

const shellChecks = [
  { path: '/app/dashboard', status: 200 },
  { path: `/share/${SHARE_ID}`, status: 200 },
  { path: '/sign-in', status: 200 },
  { path: '/zh/sign-up', status: 200 },
];

const documentChecks = [
  {
    kind: 'landing',
    lang: 'en',
    marker: 'en',
    path: '/',
    status: 200,
    title: 'Lumen — Turn products into videos that sell',
  },
  {
    kind: 'landing',
    lang: 'zh-CN',
    marker: 'zh',
    path: '/zh',
    status: 200,
    title: 'Lumen — 把商品变成爆款带货视频',
  },
  {
    kind: 'auth',
    lang: 'en',
    marker: 'en',
    path: '/sign-in',
    status: 200,
    title: 'Account — Lumen',
  },
  {
    kind: 'auth',
    lang: 'zh-CN',
    marker: 'zh',
    path: '/zh/sign-up',
    status: 200,
    title: '账户 — Lumen',
  },
  {
    kind: 'not-found',
    lang: 'en',
    marker: 'en',
    path: '/missing-static-page',
    status: 404,
    title: 'Page not found — Lumen',
  },
  {
    kind: 'not-found',
    lang: 'zh-CN',
    marker: 'zh',
    path: '/zh/missing-static-page',
    status: 404,
    title: '页面不存在 — Lumen',
  },
];

export async function verifyDeploymentWithRetry(options) {
  const attempts = readPositiveInteger(options.attempts ?? 1, 'attempts');
  const delayMs = readNonNegativeInteger(options.delayMs ?? 0, 'delayMs');
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const result = await verifyDeployment(options);
      return { ...result, attempt };
    } catch (error) {
      lastError = error;
      if (attempt === attempts) break;
      options.onRetry?.({ attempt, error });
      await (options.sleep ?? sleep)(delayMs);
    }
  }

  throw new Error(`deployment verification failed after ${attempts} attempt(s)`, {
    cause: lastError,
  });
}

export async function verifyDeployment({
  baseUrl,
  fetchImpl = fetch,
  release,
  requestTimeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  requireOriginPassthrough = false,
}) {
  const normalizedBaseUrl = requireBaseUrl(baseUrl);
  const normalizedRelease = requireRelease(release);
  const timeoutMs = readPositiveInteger(requestTimeoutMs, 'requestTimeoutMs');

  for (const check of shellChecks) {
    const response = await request(fetchImpl, normalizedBaseUrl, check.path, timeoutMs);
    requireStatus(response, check.path, check.status);
    requireReleaseHeader(response, check.path, normalizedRelease);
  }

  for (const check of documentChecks) {
    const response = await request(fetchImpl, normalizedBaseUrl, check.path, timeoutMs, {
      locale: check.marker,
    });
    requireStatus(response, check.path, check.status);
    requireReleaseHeader(response, check.path, normalizedRelease);
    verifyDocument(await response.text(), check);
  }

  if (requireOriginPassthrough) {
    await verifyOriginPassthrough(fetchImpl, normalizedBaseUrl, timeoutMs);
  }

  return {
    baseUrl: normalizedBaseUrl.href.replace(/\/$/, ''),
    release: normalizedRelease,
    originPassthrough: requireOriginPassthrough,
    verified: true,
  };
}

async function verifyOriginPassthrough(fetchImpl, baseUrl, timeoutMs) {
  const path = '/api/me';
  const response = await request(fetchImpl, baseUrl, path, timeoutMs, {
    headers: { accept: 'application/json' },
  });
  requireStatus(response, path, 401);
  const contentType = response.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(`${path} did not return JSON from the origin`);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    throw new Error(`${path} returned invalid JSON from the origin`, { cause: error });
  }
  if (!payload || typeof payload !== 'object' || payload.ok !== false) {
    throw new Error(`${path} returned an unexpected unauthenticated response`);
  }
}

async function request(fetchImpl, baseUrl, path, timeoutMs, options = {}) {
  const headers = new Headers(options.headers);
  if (options.locale) {
    headers.set('accept-language', options.locale === 'zh' ? 'zh-CN,zh;q=0.9' : 'en-US,en;q=0.9');
    headers.set('cookie', `lumen_locale=${options.locale}`);
  }
  return fetchImpl(new URL(path, baseUrl), {
    headers,
    redirect: 'manual',
    signal: AbortSignal.timeout(timeoutMs),
  });
}

function verifyDocument(html, check) {
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? '';
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1].trim();
  const rootMatch = html.match(/<div\b[^>]*\bid\s*=\s*(["'])root\1[^>]*>/i);
  const rootTag = rootMatch?.[0] ?? '';
  const afterRoot = rootMatch ? html.slice(rootMatch.index + rootTag.length).trimStart() : '';

  if (!hasHtmlAttribute(htmlTag, 'lang', check.lang)) {
    throw new Error(`${check.path} is missing html lang ${check.lang}`);
  }
  if (title !== check.title) {
    throw new Error(`${check.path} has unexpected title ${title ?? '<missing>'}`);
  }

  if (check.kind === 'landing') {
    requireMarker(rootTag, 'data-lumen-static-landing', check.marker, check.path);
    requireMarker(rootTag, 'data-lumen-prerendered', 'true', check.path);
    if (!afterRoot || afterRoot.startsWith('</div>')) {
      throw new Error(`${check.path} has an empty landing screen`);
    }
    return;
  }

  const robotsTag = [...html.matchAll(/<meta\b[^>]*>/gi)]
    .map((match) => match[0])
    .find((tag) => hasHtmlAttribute(tag, 'name', 'robots'));
  if (!robotsTag || !hasHtmlAttribute(robotsTag, 'content', 'noindex, nofollow')) {
    throw new Error(`${check.path} must remain noindex`);
  }

  if (check.kind === 'auth') {
    requireMarker(rootTag, 'data-lumen-static-auth', check.marker, check.path);
    if (!afterRoot || !afterRoot.includes('auth-loading')) {
      throw new Error(`${check.path} has an empty authentication screen`);
    }
    return;
  }

  requireMarker(rootTag, 'data-lumen-static-not-found', check.marker, check.path);
  if (!afterRoot || !afterRoot.includes('not-found-content') || !afterRoot.includes('404')) {
    throw new Error(`${check.path} has an empty recovery screen`);
  }
}

function requireMarker(tag, name, value, path) {
  if (!hasHtmlAttribute(tag, name, value)) {
    throw new Error(`${path} is missing ${name}=${value}`);
  }
}

function requireStatus(response, path, expected) {
  if (response.status !== expected) {
    throw new Error(`${path} returned ${response.status}; expected ${expected}`);
  }
}

function requireReleaseHeader(response, path, release) {
  const actual = response.headers.get('x-lumen-release');
  if (actual !== release) {
    throw new Error(`${path} returned release ${actual ?? '<missing>'}; expected ${release}`);
  }
}

function hasHtmlAttribute(tag, name, value) {
  return new RegExp(`\\b${escapePattern(name)}\\s*=\\s*(["'])${escapePattern(value)}\\1`, 'i').test(
    tag,
  );
}

function escapePattern(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function requireBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new Error('deployment base URL is invalid', { cause: error });
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw new Error('deployment base URL must be an HTTPS origin');
  }
  if (url.pathname !== '/') throw new Error('deployment base URL must not include a path');
  return url;
}

function requireRelease(value) {
  const release = value?.trim();
  if (!release || !FULL_RELEASE_PATTERN.test(release)) {
    throw new Error('deployment release must be a full 40-character lowercase Git SHA');
  }
  return release;
}

function readPositiveInteger(value, name) {
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be positive`);
  return value;
}

function readNonNegativeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${name} cannot be negative`);
  return value;
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function parseArguments(argv) {
  const values = new Map();
  let requireOriginPassthrough = false;
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--require-origin-passthrough') {
      requireOriginPassthrough = true;
      continue;
    }
    if (!['--attempts', '--base-url', '--delay-ms', '--release'].includes(name)) {
      throw new Error(`unknown deployment verification argument: ${name}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    if (values.has(name)) throw new Error(`${name} cannot be repeated`);
    values.set(name, value);
    index += 1;
  }

  return {
    attempts: Number(values.get('--attempts') ?? '1'),
    baseUrl: values.get('--base-url'),
    delayMs: Number(values.get('--delay-ms') ?? '0'),
    release: values.get('--release'),
    requireOriginPassthrough,
  };
}

const entryPath = process.argv[1];
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  void verifyDeploymentWithRetry({
    ...parseArguments(process.argv.slice(2)),
    onRetry({ attempt, error }) {
      console.error(`deployment verification attempt ${attempt} failed`, error);
    },
  })
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}
