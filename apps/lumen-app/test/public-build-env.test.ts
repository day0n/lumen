import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const scriptPath = path.resolve(import.meta.dirname, '../scripts/prepare-public-build-env.mjs');

test('production frontend config maps legacy public values without copying secrets', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumen-app-public-env-'));
  const sourcePath = path.join(directory, 'studio.env');
  const outputPath = path.join(directory, 'app.env');
  context.after(() => rm(directory, { force: true, recursive: true }));
  await writeFile(
    sourcePath,
    [
      'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_browser',
      'NEXT_PUBLIC_SENTRY_DSN=https://public@example.invalid/1',
      'SENTRY_ENVIRONMENT=production',
      'CLERK_SECRET_KEY=must-not-be-copied',
      'MONGODB_URI=mongodb://must-not-be-copied',
    ].join('\n'),
  );

  await execFileAsync(
    process.execPath,
    [scriptPath, '--source', sourcePath, '--output', outputPath],
    { env: {} },
  );
  const output = await readFile(outputPath, 'utf8');

  assert.match(output, /^VITE_CLERK_PUBLISHABLE_KEY="pk_test_browser"$/m);
  assert.match(output, /^VITE_SENTRY_DSN="https:\/\/public@example\.invalid\/1"$/m);
  assert.match(output, /^VITE_SENTRY_ENVIRONMENT="production"$/m);
  assert.doesNotMatch(output, /CLERK_SECRET_KEY|MONGODB_URI|must-not-be-copied/);
});

test('production frontend config fails before writing an incomplete environment', async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumen-app-missing-env-'));
  const sourcePath = path.join(directory, 'studio.env');
  const outputPath = path.join(directory, 'app.env');
  context.after(() => rm(directory, { force: true, recursive: true }));
  await writeFile(sourcePath, 'NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=pk_test_browser\n');

  await assert.rejects(
    execFileAsync(process.execPath, [scriptPath, '--source', sourcePath, '--output', outputPath], {
      env: {},
    }),
    (error: unknown) =>
      String((error as { stderr?: string }).stderr).includes(
        'required frontend build configuration is missing: VITE_SENTRY_DSN',
      ),
  );
  await assert.rejects(readFile(outputPath, 'utf8'), /ENOENT/);
});
