#!/usr/bin/env node

import process from 'node:process';
import { pathToFileURL } from 'node:url';

const FULL_RELEASE_PATTERN = /^[0-9a-f]{40}$/i;
const SAFE_REQUEST_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;
const DEFAULT_BASE_URL = 'http://127.0.0.1:3003';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_INTERVAL_MS = 500;

const USAGE = `Usage:
  pnpm --filter @lumen/api verify:release -- --release <full-git-sha> [options]

Options:
  --base-url <url>       API origin (default: ${DEFAULT_BASE_URL})
  --release <sha>        Expected full 40-character Git release SHA
  --timeout-ms <ms>      Overall verification timeout (default: ${DEFAULT_TIMEOUT_MS})
  --interval-ms <ms>     Poll interval (default: ${DEFAULT_INTERVAL_MS})
  --help                 Show this help

Environment:
  LUMEN_API_VERIFY_BASE_URL
  LUMEN_API_VERIFY_RELEASE (fallback: RELEASE_SHA, GITHUB_SHA)
  LUMEN_API_VERIFY_TIMEOUT_MS
  LUMEN_API_VERIFY_INTERVAL_MS`;

export class ReleaseVerificationError extends Error {
  constructor(message, options) {
    super(message, options);
    this.name = 'ReleaseVerificationError';
  }
}

export function parseOptions(argv = process.argv.slice(2), env = process.env) {
  const parsed = parseArguments(argv);
  if (parsed.help) return { help: true };

  const baseUrl = normalizeBaseUrl(
    parsed.baseUrl ?? env.LUMEN_API_VERIFY_BASE_URL ?? env.API_BASE_URL ?? DEFAULT_BASE_URL,
  );
  const release = normalizeRelease(
    parsed.release ??
      env.LUMEN_API_VERIFY_RELEASE ??
      env.EXPECTED_RELEASE_SHA ??
      env.RELEASE_SHA ??
      env.GITHUB_SHA,
  );
  const timeoutMs = readPositiveInteger(
    parsed.timeoutMs ?? env.LUMEN_API_VERIFY_TIMEOUT_MS,
    'timeout',
    DEFAULT_TIMEOUT_MS,
  );
  const intervalMs = readPositiveInteger(
    parsed.intervalMs ?? env.LUMEN_API_VERIFY_INTERVAL_MS,
    'interval',
    DEFAULT_INTERVAL_MS,
  );

  if (intervalMs > timeoutMs) {
    throw new ReleaseVerificationError('Poll interval cannot exceed the overall timeout');
  }

  return { baseUrl, intervalMs, release, timeoutMs };
}

export async function verifyRelease(options, dependencies = {}) {
  const fetchImpl = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? defaultSleep;
  if (typeof fetchImpl !== 'function') {
    throw new ReleaseVerificationError('This Node.js runtime does not provide fetch');
  }

  const deadline = now() + options.timeoutMs;
  const request = (pathname) =>
    requestJson({
      baseUrl: options.baseUrl,
      deadline,
      fetchImpl,
      now,
      pathname,
    });

  await pollUntilHealthy({
    deadline,
    intervalMs: options.intervalMs,
    label: 'liveness probe /healthz',
    now,
    request: () => request('/healthz'),
    sleep,
    validate: (result) => validateHealthProbe(result, options.release, false),
  });
  await pollUntilHealthy({
    deadline,
    intervalMs: options.intervalMs,
    label: 'readiness probe /readyz',
    now,
    request: () => request('/readyz'),
    sleep,
    validate: (result) => validateHealthProbe(result, options.release, true),
  });

  validateFeaturedResponse(await request('/api/home/featured'), options.release);
  validateTemplatesResponse(await request('/api/home/templates'), options.release);

  return {
    baseUrl: options.baseUrl,
    release: options.release,
  };
}

export function validateHealthProbe(result, expectedRelease, readiness) {
  const pathname = readiness ? '/readyz' : '/healthz';
  validateCommonResponse(result, pathname, expectedRelease, { requireNoStore: true });
  const payload = requireObject(result.payload, `${pathname} JSON body`);

  assertEqual(payload.ok, true, `${pathname} body.ok`);
  assertEqual(payload.service, 'lumen-api', `${pathname} body.service`);
  assertRelease(payload.release, expectedRelease, `${pathname} body.release`);
  if (typeof payload.ts !== 'number' || !Number.isFinite(payload.ts)) {
    throw new ReleaseVerificationError(`${pathname} body.ts must be a finite number`);
  }

  if (readiness) {
    const checks = requireObject(payload.checks, '/readyz body.checks');
    const entries = Object.entries(checks);
    if (entries.length === 0 || entries.some(([, value]) => typeof value !== 'boolean')) {
      throw new ReleaseVerificationError(
        '/readyz body.checks must be a non-empty object of boolean values',
      );
    }
    if (checks.mongo !== true) {
      throw new ReleaseVerificationError('/readyz body.checks.mongo must be true');
    }
  }
}

export function validateFeaturedResponse(result, expectedRelease) {
  const pathname = '/api/home/featured';
  validateCommonResponse(result, pathname, expectedRelease);
  const payload = validateSuccessEnvelope(result.payload, pathname);
  const data = requireObject(payload.data, `${pathname} body.data`);
  if (!Array.isArray(data.items)) {
    throw new ReleaseVerificationError(`${pathname} body.data.items must be an array`);
  }
}

export function validateTemplatesResponse(result, expectedRelease) {
  const pathname = '/api/home/templates';
  validateCommonResponse(result, pathname, expectedRelease);
  const payload = validateSuccessEnvelope(result.payload, pathname);
  const data = requireObject(payload.data, `${pathname} body.data`);
  if (!Array.isArray(data.items)) {
    throw new ReleaseVerificationError(`${pathname} body.data.items must be an array`);
  }
  if (!Array.isArray(data.categories)) {
    throw new ReleaseVerificationError(`${pathname} body.data.categories must be an array`);
  }
}

async function pollUntilHealthy(options) {
  let attempts = 0;
  let lastFailure = 'probe was not attempted';

  while (options.now() < options.deadline) {
    attempts += 1;
    try {
      const result = await options.request();
      options.validate(result);
      return result;
    } catch (error) {
      lastFailure = describeError(error);
    }

    const remainingMs = options.deadline - options.now();
    if (remainingMs <= 0) break;
    await options.sleep(Math.min(options.intervalMs, remainingMs));
  }

  throw new ReleaseVerificationError(
    `Timed out waiting for ${options.label} after ${attempts} attempt(s): ${lastFailure}`,
  );
}

async function requestJson({ baseUrl, deadline, fetchImpl, now, pathname }) {
  const remainingMs = deadline - now();
  if (remainingMs <= 0) {
    throw new ReleaseVerificationError(`Overall timeout expired before requesting ${pathname}`);
  }

  const url = new URL(pathname, `${baseUrl}/`);
  let response;
  try {
    response = await fetchImpl(url, {
      headers: { accept: 'application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(Math.max(1, remainingMs)),
    });
  } catch (error) {
    throw new ReleaseVerificationError(`${pathname} request failed: ${describeError(error)}`, {
      cause: error,
    });
  }

  const body = await response.text();
  let payload;
  try {
    payload = JSON.parse(body);
  } catch (error) {
    throw new ReleaseVerificationError(
      `${pathname} returned invalid JSON (status ${response.status}): ${summarizeBody(body)}`,
      { cause: error },
    );
  }

  return { body, payload, response };
}

function validateCommonResponse(result, pathname, expectedRelease, options = {}) {
  if (result.response.status !== 200) {
    throw new ReleaseVerificationError(
      `${pathname} returned status ${result.response.status}, expected 200: ${summarizeBody(result.body)}`,
    );
  }

  const contentType = result.response.headers.get('content-type')?.toLowerCase() ?? '';
  if (!contentType.includes('application/json')) {
    throw new ReleaseVerificationError(
      `${pathname} content-type must be application/json, received ${contentType || '<missing>'}`,
    );
  }

  assertRelease(
    result.response.headers.get('x-lumen-release'),
    expectedRelease,
    `${pathname} x-lumen-release header`,
  );

  const requestId = result.response.headers.get('x-request-id')?.trim();
  if (!requestId || !SAFE_REQUEST_ID_PATTERN.test(requestId)) {
    throw new ReleaseVerificationError(
      `${pathname} x-request-id header is missing or contains an invalid value`,
    );
  }

  if (options.requireNoStore) {
    const cacheControl = result.response.headers.get('cache-control')?.toLowerCase() ?? '';
    if (!cacheControl.split(',').some((value) => value.trim() === 'no-store')) {
      throw new ReleaseVerificationError(
        `${pathname} cache-control must contain no-store, received ${cacheControl || '<missing>'}`,
      );
    }
  }
}

function validateSuccessEnvelope(value, pathname) {
  const payload = requireObject(value, `${pathname} JSON body`);
  assertEqual(payload.ok, true, `${pathname} body.ok`);
  if (!Object.hasOwn(payload, 'data')) {
    throw new ReleaseVerificationError(`${pathname} body.data is required`);
  }
  return payload;
}

function parseArguments(argv) {
  const parsed = {};
  const names = new Map([
    ['--base-url', 'baseUrl'],
    ['--expected-release', 'release'],
    ['--interval', 'intervalMs'],
    ['--interval-ms', 'intervalMs'],
    ['--release', 'release'],
    ['--timeout', 'timeoutMs'],
    ['--timeout-ms', 'timeoutMs'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--') continue;
    if (argument === '--help' || argument === '-h') return { help: true };

    const separatorIndex = argument.indexOf('=');
    const name = separatorIndex === -1 ? argument : argument.slice(0, separatorIndex);
    const key = names.get(name);
    if (!key) throw new ReleaseVerificationError(`Unknown option: ${name}`);

    const value = separatorIndex === -1 ? argv[index + 1] : argument.slice(separatorIndex + 1);
    if (!value || (separatorIndex === -1 && value.startsWith('--'))) {
      throw new ReleaseVerificationError(`Option ${name} requires a value`);
    }
    parsed[key] = value;
    if (separatorIndex === -1) index += 1;
  }

  return parsed;
}

function normalizeBaseUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch (error) {
    throw new ReleaseVerificationError(`Invalid API base URL: ${value}`, { cause: error });
  }

  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new ReleaseVerificationError('API base URL must use http or https');
  }
  if (url.username || url.password || url.search || url.hash || !['', '/'].includes(url.pathname)) {
    throw new ReleaseVerificationError(
      'API base URL must be an origin without credentials, path, query, or fragment',
    );
  }
  return url.origin;
}

function normalizeRelease(value) {
  const release = value?.trim().toLowerCase();
  if (!release || !FULL_RELEASE_PATTERN.test(release)) {
    throw new ReleaseVerificationError(
      'Expected release must be a full 40-character hexadecimal Git SHA; pass --release or LUMEN_API_VERIFY_RELEASE',
    );
  }
  return release;
}

function readPositiveInteger(value, label, fallback) {
  if (value === undefined || value === '') return fallback;
  if (!/^\d+$/.test(String(value))) {
    throw new ReleaseVerificationError(`${label} must be a positive integer in milliseconds`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new ReleaseVerificationError(`${label} must be a positive integer in milliseconds`);
  }
  return parsed;
}

function assertRelease(actual, expected, label) {
  const normalized = typeof actual === 'string' ? actual.trim().toLowerCase() : '';
  if (normalized !== expected) {
    throw new ReleaseVerificationError(
      `${label} must equal ${expected}, received ${actual || '<missing>'}`,
    );
  }
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) {
    throw new ReleaseVerificationError(
      `${label} must be ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
    );
  }
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ReleaseVerificationError(`${label} must be an object`);
  }
  return value;
}

function summarizeBody(body) {
  const normalized = body.replace(/\s+/g, ' ').trim();
  if (!normalized) return '<empty body>';
  return normalized.length <= 300 ? normalized : `${normalized.slice(0, 297)}...`;
}

function describeError(error) {
  return error instanceof Error ? error.message : String(error);
}

function defaultSleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

export async function runCli(argv = process.argv.slice(2), env = process.env) {
  const options = parseOptions(argv, env);
  if (options.help) {
    console.log(USAGE);
    return;
  }

  const result = await verifyRelease(options);
  console.log(`[lumen-api] verified release ${result.release} at ${result.baseUrl}`);
}

const entrypoint = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entrypoint === import.meta.url) {
  runCli().catch((error) => {
    console.error(`[lumen-api] release verification failed: ${describeError(error)}`);
    process.exitCode = 1;
  });
}
