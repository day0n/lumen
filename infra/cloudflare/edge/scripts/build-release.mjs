#!/usr/bin/env node

import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs, promisify } from 'node:util';
import { verifyReleaseDirectory } from '../src/release-inventory.mjs';
import { packageAppRelease } from '../src/release-package.mjs';

const run = promisify(execFile);
const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, '../../../..');
const { values } = parseArgs({
  options: {
    release: { type: 'string' },
    'output-root': { type: 'string' },
  },
});

const headRelease = (await readHeadRelease()).toLowerCase();
const release = (values.release ?? process.env.GITHUB_SHA ?? headRelease).trim().toLowerCase();
if (release !== headRelease) {
  throw new Error(`frontend release ${release} does not match HEAD ${headRelease}`);
}
await requireCleanWorktree('before frontend build');
const outputRoot = values['output-root']
  ? path.resolve(values['output-root'])
  : path.join(repositoryRoot, '.artifacts', 'frontend', 'releases');

await runAppBuild(release);
if ((await readHeadRelease()).toLowerCase() !== release) {
  throw new Error('repository HEAD changed during the frontend build');
}
await requireCleanWorktree('after frontend build');
const result = await packageAppRelease({
  release,
  distDirectory: path.join(repositoryRoot, 'apps', 'lumen-app', 'dist'),
  appPublicDirectory: path.join(repositoryRoot, 'apps', 'lumen-app', 'public'),
  studioPublicDirectory: path.join(repositoryRoot, 'apps', 'lumen-studio', 'public'),
  iconFile: path.join(repositoryRoot, 'apps', 'lumen-studio', 'src', 'app', 'icon.svg'),
  outputRoot,
});
const inventory = await verifyReleaseDirectory({
  release,
  releaseDirectory: result.releaseDirectory,
});

process.stdout.write(
  `${JSON.stringify(
    {
      release: result.release,
      scope: result.manifest.scope,
      output: result.releaseDirectory,
      objectCount: inventory.objects.length,
      manifestSha256: result.ready.manifest.sha256,
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

async function requireCleanWorktree(stage) {
  const { stdout } = await run('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: repositoryRoot,
  });
  if (stdout.trim()) {
    throw new Error(`frontend release requires a clean worktree ${stage}`);
  }
}

async function runAppBuild(frontendRelease) {
  await new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['--filter', '@lumen/app', 'build'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        LUMEN_FRONTEND_RELEASE: frontendRelease,
        LUMEN_FRONTEND_RELEASE_BUILD: '1',
      },
      stdio: 'inherit',
    });
    child.once('error', reject);
    child.once('exit', (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`frontend build failed (${signal ?? code ?? 'unknown'})`));
    });
  });
}
