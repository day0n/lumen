const fs = require('node:fs');
const path = require('node:path');

const nodeInterpreter = process.env.NODE_BIN || process.execPath;
const tsxInterpreter = process.env.TSX_BIN || 'tsx';
const runtimePath = [path.dirname(nodeInterpreter), process.env.PATH].filter(Boolean).join(':');
const apiEnvFile = process.env.LUMEN_API_ENV_FILE;
const releaseSha = process.env.RELEASE_SHA;

if (!apiEnvFile || !path.isAbsolute(apiEnvFile)) {
  throw new Error('LUMEN_API_ENV_FILE must be an absolute path');
}
if (!fs.existsSync(apiEnvFile) || !fs.statSync(apiEnvFile).isFile()) {
  throw new Error(`LUMEN_API_ENV_FILE is not a file: ${apiEnvFile}`);
}
if (!releaseSha || !/^[0-9a-f]{40}$/i.test(releaseSha)) {
  throw new Error('RELEASE_SHA must be a full 40-character Git SHA');
}

module.exports = {
  apps: [
    {
      name: 'lumen-studio',
      cwd: './apps/lumen-studio',
      script: 'server.ts',
      interpreter: tsxInterpreter,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
        NEXT_DIST_DIR: process.env.NEXT_DIST_DIR || '.next-current',
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'https://lumenstudio.tech',
        PATH: runtimePath,
      },
    },
    {
      name: 'lumen-api',
      cwd: './apps/lumen-api',
      script: 'dist/main.js',
      interpreter: nodeInterpreter,
      node_args: [`--env-file=${apiEnvFile}`],
      filter_env: ['MONGODB_', 'REDIS_'],
      kill_timeout: 15000,
      min_uptime: 10000,
      max_restarts: 5,
      restart_delay: 2000,
      env: {
        NODE_ENV: 'production',
        API_HOST: '127.0.0.1',
        API_PORT: 3003,
        API_READINESS_TIMEOUT_MS: 2000,
        API_SHUTDOWN_TIMEOUT_MS: 10000,
        RELEASE_SHA: releaseSha,
        PATH: runtimePath,
      },
    },
    {
      name: 'lumen-agent',
      cwd: './apps/lumen-agent',
      script: 'dist/main.js',
      interpreter: nodeInterpreter,
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
        PATH: runtimePath,
      },
    },
    {
      name: 'lumen-engine',
      cwd: './apps/lumen-engine',
      script: 'dist/main.js',
      interpreter: nodeInterpreter,
      env: {
        NODE_ENV: 'production',
        PATH: runtimePath,
        VIDEO_EDIT_FONT_FILE:
          process.env.VIDEO_EDIT_FONT_FILE ||
          '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
      },
    },
  ],
};
