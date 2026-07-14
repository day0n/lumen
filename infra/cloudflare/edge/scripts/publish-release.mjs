#!/usr/bin/env node

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { verifyReleaseDirectory } from '../src/release-inventory.mjs';
import { ensureSafeDirectoryChain } from '../src/release-local-directory.mjs';
import { publishImmutableRelease } from '../src/release-publisher.mjs';

const run = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../../../..');
const { values } = parseArgs({
  options: {
    release: { type: 'string' },
    'release-directory': { type: 'string' },
    concurrency: { type: 'string', default: '8' },
    'dry-run': { type: 'boolean', default: false },
  },
});

const release = (values.release ?? process.env.GITHUB_SHA ?? (await readHeadRelease()))
  .trim()
  .toLowerCase();
const releaseDirectory = values['release-directory']
  ? path.resolve(values['release-directory'])
  : path.join(await readDefaultReleaseRoot(), release);
const concurrency = parseConcurrency(values.concurrency);
const inventory = await verifyReleaseDirectory({ release, releaseDirectory });

if (values['dry-run']) {
  const result = await publishImmutableRelease({ inventory, concurrency, dryRun: true });
  writeResult({
    release: result.release,
    prefix: result.prefix,
    directory: inventory.releaseDirectory,
    dryRun: true,
    objectCount: result.objectCount,
    plannedPutCount: result.plannedPuts.length,
    verified: true,
  });
} else {
  const credentials = readR2Configuration();
  const { createR2ReleaseStore } = await import('../src/r2-release-store.mjs');
  const store = await createR2ReleaseStore(credentials);
  const result = await publishImmutableRelease({ inventory, store, concurrency });
  writeResult({
    release: result.release,
    prefix: result.prefix,
    directory: inventory.releaseDirectory,
    dryRun: false,
    state: result.state,
    action: result.action,
    objectCount: result.objectCount,
    auditedObjectCount: result.auditedObjectCount,
    putCount: result.putCount,
    verified: true,
  });
}

function readR2Configuration() {
  return {
    accountId: requireEnvironment('FRONTEND_R2_ACCOUNT_ID'),
    bucket: requireEnvironment('FRONTEND_R2_BUCKET'),
    accessKeyId: requireEnvironment('FRONTEND_R2_ACCESS_KEY_ID'),
    secretAccessKey: requireEnvironment('FRONTEND_R2_SECRET_ACCESS_KEY'),
  };
}

function requireEnvironment(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`missing required environment variable ${name}`);
  return value;
}

function parseConcurrency(value) {
  if (!/^[1-9][0-9]*$/.test(value)) {
    throw new Error('frontend publish concurrency must be a positive integer');
  }
  const concurrency = Number(value);
  if (!Number.isSafeInteger(concurrency)) {
    throw new Error('frontend publish concurrency must be a safe integer');
  }
  return concurrency;
}

function writeResult(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

async function readHeadRelease() {
  const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot });
  return stdout.trim();
}

async function readDefaultReleaseRoot() {
  return ensureSafeDirectoryChain({
    baseDirectory: repositoryRoot,
    segments: ['.artifacts', 'frontend', 'releases'],
  });
}
