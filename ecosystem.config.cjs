const path = require('node:path');

const nodeInterpreter = process.env.NODE_BIN || process.execPath;
const tsxInterpreter = process.env.TSX_BIN || 'tsx';
const runtimePath = [path.dirname(nodeInterpreter), process.env.PATH].filter(Boolean).join(':');

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
        NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL || 'https://lumenstudio.tech',
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
      },
    },
  ],
};
