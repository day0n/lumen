const nodeInterpreter = process.env.NODE_BIN || process.execPath;

module.exports = {
  apps: [
    {
      name: 'lumen-studio',
      cwd: './apps/lumen-studio',
      script: './node_modules/tsx/dist/cli.mjs',
      args: 'server.ts',
      interpreter: nodeInterpreter,
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
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
      },
    },
    {
      name: 'lumen-engine',
      cwd: './apps/lumen-engine',
      script: 'dist/main.js',
      interpreter: nodeInterpreter,
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
