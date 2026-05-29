import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  serverExternalPackages: ['mongodb', 'ioredis'],
  experimental: {
    optimizePackageImports: ['@mantine/core', '@mantine/hooks', '@tabler/icons-react'],
  },
  transpilePackages: ['@lumen/shared', '@lumen/db'],
};

export default nextConfig;
