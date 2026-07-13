import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const require = createRequire(import.meta.url);
const repositoryRoot = path.resolve(import.meta.dirname, '../../..');
const ecosystemPath = path.join(repositoryRoot, 'ecosystem.config.cjs');
const deployPath = path.join(repositoryRoot, 'deploy.sh');
const RELEASE = '0123456789abcdef0123456789abcdef01234567';

test('process configuration starts the API with an explicit release and env file', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'lumen-api-process-'));
  const envFile = path.join(temporaryDirectory, 'api.env');
  await writeFile(envFile, 'MONGODB_URI=mongodb://127.0.0.1/lumen_test\n');
  context.after(() => rm(temporaryDirectory, { force: true, recursive: true }));

  const previousEnvFile = process.env.LUMEN_API_ENV_FILE;
  const previousRelease = process.env.RELEASE_SHA;
  process.env.LUMEN_API_ENV_FILE = envFile;
  process.env.RELEASE_SHA = RELEASE;
  context.after(() => {
    restoreEnvironment('LUMEN_API_ENV_FILE', previousEnvFile);
    restoreEnvironment('RELEASE_SHA', previousRelease);
    delete require.cache[require.resolve(ecosystemPath)];
  });

  const configuration = require(ecosystemPath) as {
    apps: Array<{
      cwd: string;
      env: Record<string, unknown>;
      filter_env?: string[];
      kill_timeout?: number;
      max_restarts?: number;
      min_uptime?: number;
      name: string;
      node_args?: string[];
      restart_delay?: number;
      script: string;
    }>;
  };
  const api = configuration.apps.find((application) => application.name === 'lumen-api');

  assert.ok(api);
  assert.equal(api.cwd, './apps/lumen-api');
  assert.equal(api.script, 'dist/main.js');
  assert.deepEqual(api.node_args, [`--env-file=${envFile}`]);
  assert.equal(api.env.NODE_ENV, 'production');
  assert.equal(api.env.API_HOST, '127.0.0.1');
  assert.equal(api.env.API_PORT, 3003);
  assert.equal(api.env.API_READINESS_TIMEOUT_MS, 2000);
  assert.equal(api.env.API_SHUTDOWN_TIMEOUT_MS, 10000);
  assert.equal(api.env.RELEASE_SHA, RELEASE);
  assert.deepEqual(api.filter_env, ['MONGODB_', 'REDIS_', 'CLERK_']);
  assert.ok((api.kill_timeout ?? 0) > Number(api.env.API_SHUTDOWN_TIMEOUT_MS));
  assert.equal(api.min_uptime, 10000);
  assert.equal(api.max_restarts, 5);
  assert.equal(api.restart_delay, 2000);
});

test('process configuration rejects missing env files and short releases', async (context) => {
  const temporaryDirectory = await mkdtemp(path.join(tmpdir(), 'lumen-api-invalid-process-'));
  const envFile = path.join(temporaryDirectory, 'api.env');
  await writeFile(envFile, 'MONGODB_URI=mongodb://127.0.0.1/lumen_test\n');
  context.after(() => rm(temporaryDirectory, { force: true, recursive: true }));
  const loadConfiguration = (environment: NodeJS.ProcessEnv) =>
    execFileAsync(process.execPath, ['--eval', `require(${JSON.stringify(ecosystemPath)})`], {
      env: { ...process.env, ...environment },
    });

  await assert.rejects(
    loadConfiguration({ LUMEN_API_ENV_FILE: path.join(temporaryDirectory, 'missing.env') }),
    (error: unknown) => String((error as { stderr?: string }).stderr).includes('is not a file'),
  );
  await assert.rejects(
    loadConfiguration({ LUMEN_API_ENV_FILE: envFile, RELEASE_SHA: 'abc123' }),
    (error: unknown) =>
      String((error as { stderr?: string }).stderr).includes('full 40-character Git SHA'),
  );
});

test('deployment verifies the API before activating its public routes and Studio', async () => {
  await execFileAsync('bash', ['-n', deployPath]);
  const source = await readFile(deployPath, 'utf8');
  const orderedMarkers = [
    'RELEASE_SHA="$(git rev-parse --verify HEAD)"',
    'API_ENV_FILE="$APP_DIR/apps/lumen-api/.env.local"',
    'pnpm build:api',
    'pm2 startOrReload ecosystem.config.cjs --only lumen-api --update-env',
    'pnpm --filter @lumen/api verify:release',
    'echo "==> Activating the public API proxy..."',
    'bash "$NGINX_ACTIVATION_SCRIPT"',
    '--public-base-url http://127.0.0.1',
    'echo "==> Activating studio build..."',
    'echo "==> Ensuring nginx upload limit..."',
    'pm2 startOrReload ecosystem.config.cjs \\\n  --only lumen-studio,lumen-agent,lumen-engine',
    'pm2 save',
  ];
  let previousIndex = -1;
  for (const marker of orderedMarkers) {
    const index = source.indexOf(marker);
    assert.ok(index > previousIndex, `${marker} is missing or out of deployment order`);
    previousIndex = index;
  }

  assert.match(source, /apps\/lumen-studio\/\.env\.local/);
  assert.match(source, /chmod 600 "\$LUMEN_API_ENV_FILE"/);
  assert.match(source, /--base-url http:\/\/127\.0\.0\.1:3003/);
  assert.match(source, /infra\/nginx\/lumenstudio\.tech\.conf/);
  assert.match(source, /infra\/nginx\/activate-site\.sh/);
  assert.match(source, /\/etc\/nginx\/sites-available\/lumenstudio\.tech/);
  assert.match(source, /\/etc\/nginx\/sites-enabled\/lumenstudio\.tech/);
  assert.match(source, /^set -euo pipefail$/m);
  assert.doesNotMatch(source, /proxy_pass\s+http:\/\/127\.0\.0\.1:3003/);
});

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}
