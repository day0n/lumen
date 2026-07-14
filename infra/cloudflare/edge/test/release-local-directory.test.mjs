import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { ensureSafeDirectoryChain } from '../src/release-local-directory.mjs';

test('creates and verifies a directory chain below a trusted base', async (context) => {
  const baseDirectory = await createTemporaryDirectory(context);
  const result = await ensureSafeDirectoryChain({
    baseDirectory,
    segments: ['.artifacts', 'frontend', 'releases'],
    create: true,
  });

  assert.equal(result, path.join(baseDirectory, '.artifacts', 'frontend', 'releases'));
  assert.equal(
    await ensureSafeDirectoryChain({
      baseDirectory,
      segments: ['.artifacts', 'frontend', 'releases'],
    }),
    result,
  );
});

test('rejects a symbolic-link component below the trusted base', async (context) => {
  const baseDirectory = await createTemporaryDirectory(context);
  const externalDirectory = path.join(baseDirectory, 'external');
  await mkdir(externalDirectory);
  await symlink(externalDirectory, path.join(baseDirectory, '.artifacts'));

  await assert.rejects(
    ensureSafeDirectoryChain({
      baseDirectory,
      segments: ['.artifacts', 'frontend', 'releases'],
      create: true,
    }),
    /directory chain is missing or unsafe/,
  );
});

async function createTemporaryDirectory(context) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'lumen-release-directory-'));
  context.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}
