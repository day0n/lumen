import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const activationScript = path.join(repositoryRoot, 'infra/nginx/activate-site.sh');

test('nginx site activation verifies the candidate before keeping it', async (context) => {
  const fixture = await createFixture(context);

  await activate(fixture);

  assert.equal(await readFile(fixture.target, 'utf8'), 'candidate-site\n');
  assert.deepEqual(await readLog(fixture.log), [
    'nginx -t candidate-site',
    'systemctl reload nginx candidate-site',
    'verify candidate-site',
  ]);
});

test('nginx site activation restores and reloads the previous site when verification fails', async (context) => {
  const fixture = await createFixture(context);

  await assert.rejects(
    activate(fixture, { VERIFY_EXIT: '23' }),
    (error: unknown) => (error as { code?: number }).code === 23,
  );

  assert.equal(await readFile(fixture.target, 'utf8'), 'previous-site\n');
  assert.deepEqual(await readLog(fixture.log), [
    'nginx -t candidate-site',
    'systemctl reload nginx candidate-site',
    'verify candidate-site',
    'nginx -t previous-site',
    'systemctl reload nginx previous-site',
  ]);
});

test('nginx site activation restores the previous site when candidate validation fails', async (context) => {
  const fixture = await createFixture(context, 'candidate-invalid\n');

  await assert.rejects(activate(fixture), (error: unknown) => {
    return (error as { code?: number }).code === 1;
  });

  assert.equal(await readFile(fixture.target, 'utf8'), 'previous-site\n');
  assert.deepEqual(await readLog(fixture.log), [
    'nginx -t candidate-invalid',
    'nginx -t previous-site',
    'systemctl reload nginx previous-site',
  ]);
});

test('nginx site activation restores the previous site when candidate reload fails', async (context) => {
  const fixture = await createFixture(context);

  await assert.rejects(
    activate(fixture, { FAIL_CANDIDATE_RELOAD: '1' }),
    (error: unknown) => (error as { code?: number }).code === 24,
  );

  assert.equal(await readFile(fixture.target, 'utf8'), 'previous-site\n');
  assert.deepEqual(await readLog(fixture.log), [
    'nginx -t candidate-site',
    'systemctl reload nginx candidate-site',
    'nginx -t previous-site',
    'systemctl reload nginx previous-site',
  ]);
});

type Fixture = {
  enabled: string;
  environment: NodeJS.ProcessEnv;
  log: string;
  source: string;
  target: string;
  verifier: string;
};

async function createFixture(
  context: test.TestContext,
  candidate = 'candidate-site\n',
): Promise<Fixture> {
  const directory = await mkdtemp(path.join(tmpdir(), 'lumen-nginx-activation-'));
  context.after(() => rm(directory, { force: true, recursive: true }));

  const binDirectory = path.join(directory, 'bin');
  const sitesAvailable = path.join(directory, 'sites-available');
  const sitesEnabled = path.join(directory, 'sites-enabled');
  await Promise.all([mkdir(binDirectory), mkdir(sitesAvailable), mkdir(sitesEnabled)]);

  const source = path.join(directory, 'candidate.conf');
  const target = path.join(sitesAvailable, 'lumenstudio.test');
  const enabled = path.join(sitesEnabled, 'lumenstudio.test');
  const log = path.join(directory, 'commands.log');
  const verifier = path.join(binDirectory, 'verify-release');

  await Promise.all([
    writeFile(source, candidate),
    writeFile(target, 'previous-site\n'),
    writeFile(log, ''),
    writeExecutable(
      path.join(binDirectory, 'nginx'),
      `#!/bin/bash
set -eu
site="$(tr -d '\\n' < "$TEST_SITE_TARGET")"
echo "nginx $* $site" >> "$TEST_LOG"
if [ "$site" = "candidate-invalid" ]; then exit 1; fi
`,
    ),
    writeExecutable(
      path.join(binDirectory, 'systemctl'),
      `#!/bin/bash
set -eu
site="$(tr -d '\\n' < "$TEST_SITE_TARGET")"
echo "systemctl $* $site" >> "$TEST_LOG"
if [ "\${FAIL_CANDIDATE_RELOAD:-0}" = "1" ] && [ "$site" = "candidate-site" ]; then exit 24; fi
`,
    ),
    writeExecutable(
      verifier,
      `#!/bin/bash
set -eu
site="$(tr -d '\\n' < "$TEST_SITE_TARGET")"
echo "verify $site" >> "$TEST_LOG"
exit "\${VERIFY_EXIT:-0}"
`,
    ),
  ]);
  await symlink(target, enabled);

  return {
    enabled,
    environment: {
      ...process.env,
      PATH: `${binDirectory}:${process.env.PATH ?? ''}`,
      TEST_LOG: log,
      TEST_SITE_TARGET: target,
    },
    log,
    source,
    target,
    verifier,
  };
}

async function activate(fixture: Fixture, environment: NodeJS.ProcessEnv = {}) {
  return execFileAsync(
    'bash',
    [activationScript, fixture.source, fixture.target, fixture.enabled, '--', fixture.verifier],
    { env: { ...fixture.environment, ...environment } },
  );
}

async function readLog(log: string) {
  const contents = await readFile(log, 'utf8');
  return contents.trim().split('\n').filter(Boolean);
}

async function writeExecutable(file: string, contents: string) {
  await writeFile(file, contents);
  await chmod(file, 0o755);
}
