#!/usr/bin/env node

import { execFile } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { verifyReleaseDirectory } from '../src/release-inventory.mjs';

const run = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../../../..');
const { values } = parseArgs({
  options: {
    release: { type: 'string' },
    'release-directory': { type: 'string' },
  },
});

const release = (values.release ?? process.env.GITHUB_SHA ?? (await readHeadRelease()))
  .trim()
  .toLowerCase();
const releaseDirectory = values['release-directory']
  ? path.resolve(values['release-directory'])
  : path.join(repositoryRoot, '.artifacts', 'frontend', 'releases', release);
const inventory = await verifyReleaseDirectory({ release, releaseDirectory });

process.stdout.write(
  `${JSON.stringify(
    {
      release: inventory.release,
      scope: inventory.manifest.scope,
      directory: inventory.releaseDirectory,
      prefix: inventory.prefix,
      objectCount: inventory.objects.length,
      manifestSha256: inventory.ready.manifest.sha256,
      verified: true,
    },
    null,
    2,
  )}\n`,
);

async function readHeadRelease() {
  const { stdout } = await run('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot });
  return stdout.trim();
}
