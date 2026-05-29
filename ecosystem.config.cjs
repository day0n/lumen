module.exports = {
  apps: [
    {
      name: 'lumen-studio',
      cwd: './apps/lumen-studio',
      script: 'server.ts',
      interpreter: 'tsx',
      env: {
        NODE_ENV: 'production',
        PORT: 3000,
      },
    },
    {
      name: 'lumen-agent',
      cwd: './apps/lumen-agent',
      script: 'dist/main.js',
      env: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },
    {
      name: 'lumen-engine',
      cwd: './apps/lumen-engine',
      script: 'dist/main.js',
      env: {
        NODE_ENV: 'production',
      },
    },
  ],
};
