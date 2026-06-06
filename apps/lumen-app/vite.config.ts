import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { type PluginOption, defineConfig, loadEnv } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const studioRoot = path.resolve(__dirname, '../lumen-studio');
const studioSrc = path.resolve(studioRoot, 'src');

const normalizePath = (id: string) => id.replace(/\\/g, '/');

const hasPackage = (id: string, packages: string[]) => {
  const normalizedId = normalizePath(id);
  return packages.some((packageName) => normalizedId.includes(`/node_modules/${packageName}/`));
};

const startsWithPackage = (id: string, prefixes: string[]) => {
  const normalizedId = normalizePath(id);
  return prefixes.some((prefix) => normalizedId.includes(`/node_modules/${prefix}`));
};

const manualChunks = (id: string): string | undefined => {
  if (!id.includes('node_modules')) return undefined;

  if (hasPackage(id, ['react', 'react-dom', 'scheduler'])) return 'react-vendor';
  if (
    startsWithPackage(id, [
      '@tanstack/react-router',
      '@tanstack/router-core',
      '@tanstack/react-query',
      '@tanstack/query-core',
    ])
  ) {
    return 'router-query-vendor';
  }
  if (startsWithPackage(id, ['@clerk/'])) return 'clerk-vendor';
  if (startsWithPackage(id, ['@sentry/'])) return 'sentry-vendor';
  if (hasPackage(id, ['@mantine/core', '@mantine/hooks', '@floating-ui/react'])) return 'ui-vendor';
  if (hasPackage(id, ['@tabler/icons-react'])) return 'icons-vendor';
  if (hasPackage(id, ['@xyflow/react', 'd3-drag', 'd3-selection'])) return 'canvas-vendor';
  if (hasPackage(id, ['@microsoft/fetch-event-source', 'nanoid'])) return 'workflow-vendor';
  if (hasPackage(id, ['motion', 'framer-motion'])) return 'motion-vendor';
  if (hasPackage(id, ['three', 'ogl'])) return 'media-vendor';

  return undefined;
};

export default defineConfig(({ mode }) => {
  const env = {
    ...loadEnv(mode, path.resolve(__dirname, '../..'), ''),
    ...loadEnv(mode, studioRoot, ''),
    ...loadEnv(mode, __dirname, ''),
  };

  const plugins: PluginOption[] = [
    tanstackRouter({
      target: 'react',
      routesDirectory: './src/routes',
      generatedRouteTree: './src/routeTree.gen.ts',
      enableRouteGeneration: false,
      autoCodeSplitting: true,
    }),
    react(),
  ];

  return {
    base: '/app/',
    envDir: studioRoot,
    plugins,
    resolve: {
      alias: [
        { find: '@app', replacement: path.resolve(__dirname, 'src') },
        { find: '@', replacement: studioSrc },
        { find: 'next/link', replacement: path.resolve(__dirname, 'src/compat/next-link.tsx') },
        {
          find: 'next/navigation',
          replacement: path.resolve(__dirname, 'src/compat/next-navigation.ts'),
        },
        { find: '@clerk/nextjs', replacement: path.resolve(__dirname, 'src/compat/clerk-next.ts') },
        {
          find: '@sentry/nextjs',
          replacement: path.resolve(__dirname, 'src/compat/sentry-next.ts'),
        },
      ],
    },
    define: {
      'process.env.NODE_ENV': JSON.stringify(mode),
      'process.env.NEXT_PUBLIC_AGENT_URL': JSON.stringify(env.NEXT_PUBLIC_AGENT_URL ?? ''),
      'process.env.NEXT_PUBLIC_SENTRY_DSN': JSON.stringify(env.NEXT_PUBLIC_SENTRY_DSN ?? ''),
      'process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify(
        env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
      ),
      __LUMEN_CLERK_PUBLISHABLE_KEY__: JSON.stringify(
        env.VITE_CLERK_PUBLISHABLE_KEY ?? env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '',
      ),
      __LUMEN_SENTRY_DSN__: JSON.stringify(
        env.VITE_SENTRY_DSN ?? env.NEXT_PUBLIC_SENTRY_DSN ?? env.SENTRY_DSN ?? '',
      ),
      __LUMEN_SENTRY_ENVIRONMENT__: JSON.stringify(
        env.VITE_SENTRY_ENVIRONMENT ?? env.SENTRY_ENVIRONMENT ?? mode,
      ),
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        output: {
          manualChunks,
        },
      },
    },
    server: {
      port: 3002,
      proxy: {
        '/api': 'http://localhost:3000',
        '/icon.svg': 'http://localhost:3000',
        '/ws': {
          target: 'ws://localhost:3000',
          ws: true,
        },
        '/monitoring': 'http://localhost:3000',
      },
    },
    preview: {
      port: 3002,
    },
  };
});
