import { withSentryConfig } from '@sentry/nextjs';
import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || '.next',
  serverExternalPackages: ['mongodb', 'ioredis'],
  experimental: {
    optimizePackageImports: ['@mantine/core', '@mantine/hooks', '@tabler/icons-react'],
  },
  transpilePackages: ['@lumen/shared', '@lumen/db'],
};

export default withSentryConfig(nextConfig, {
  org: 'lumen-y0',
  project: 'javascript-nextjs',
  // 只在配了 auth token 时上传 source map（本地开发留空即跳过）
  authToken: process.env.SENTRY_AUTH_TOKEN,
  silent: !process.env.CI,
  // 把 Sentry SDK 收拢到一个 tunnel 路由，绕过浏览器广告拦截器
  tunnelRoute: '/monitoring',
  // 禁掉 Sentry 自带的 telemetry
  telemetry: false,
});
