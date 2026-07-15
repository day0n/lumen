import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import { type PluginOption, defineConfig, loadEnv } from 'vite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const fullReleasePattern = /^[0-9a-f]{40}$/;

const normalizePath = (id: string) => id.replace(/\\/g, '/');

const hasPackage = (id: string, packages: string[]) => {
  const normalizedId = normalizePath(id);
  return packages.some((packageName) => normalizedId.includes(`/node_modules/${packageName}/`));
};

const startsWithPackage = (id: string, prefixes: string[]) => {
  const normalizedId = normalizePath(id);
  return prefixes.some((prefix) => normalizedId.includes(`/node_modules/${prefix}`));
};

function clampSampleRate(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw === '') return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) return fallback;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function readFrontendRelease() {
  const release = (
    process.env.LUMEN_FRONTEND_RELEASE ??
    process.env.GITHUB_SHA ??
    execFileSync('git', ['rev-parse', 'HEAD'], { cwd: path.resolve(__dirname, '../..') }).toString()
  )
    .trim()
    .toLowerCase();
  if (!fullReleasePattern.test(release)) {
    throw new Error('frontend release must be a full 40-character git SHA');
  }
  return release;
}

function fingerprintPublicBuildConfig(config: Record<string, string | number>) {
  const sorted = Object.fromEntries(
    Object.entries(config).sort(([left], [right]) => left.localeCompare(right)),
  );
  return createHash('sha256').update(JSON.stringify(sorted)).digest('hex');
}

function buildMetadataPlugin(metadata: Record<string, unknown>): PluginOption {
  return {
    name: 'lumen-frontend-build-metadata',
    apply: 'build',
    writeBundle(options) {
      const outputDirectory = path.resolve(__dirname, options.dir ?? 'dist');
      const metadataDirectory = path.join(outputDirectory, '.vite');
      mkdirSync(metadataDirectory, { recursive: true });
      writeFileSync(
        path.join(metadataDirectory, 'lumen-build.json'),
        `${JSON.stringify(metadata, null, 2)}\n`,
      );
    },
  };
}

function releaseHtmlAssetPlugin(releaseAssetBase: string): PluginOption {
  return {
    name: 'lumen-release-html-assets',
    apply: 'build',
    transformIndexHtml(html) {
      if (!releaseAssetBase) return html;
      const rewritten = html.replace(/(["'])\/icon\.svg\1/g, `$1${releaseAssetBase}icon.svg$1`);
      if (rewritten === html) throw new Error('release build did not find the app icon reference');
      return rewritten;
    },
  };
}

const manualChunks = (id: string): string | undefined => {
  if (!id.includes('node_modules')) return undefined;

  if (hasPackage(id, ['react', 'react-dom', 'scheduler'])) return 'react-vendor';
  if (startsWithPackage(id, ['@tanstack/react-router', '@tanstack/router-core'])) {
    return 'router-vendor';
  }
  if (hasPackage(id, ['@clerk/localizations'])) return 'clerk-localizations';
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
    ...loadEnv(mode, __dirname, ''),
  };
  const frontendRelease = readFrontendRelease();
  const isReleaseBuild = process.env.LUMEN_FRONTEND_RELEASE_BUILD === '1';
  const releaseAssetBase = isReleaseBuild ? `/_static/releases/${frontendRelease}/` : '/app/';
  const nextPublicAgentUrl = env.NEXT_PUBLIC_AGENT_URL ?? '';
  const nextPublicSentryDsn = env.NEXT_PUBLIC_SENTRY_DSN ?? '';
  const nextPublicClerkPublishableKey = env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY ?? '';
  const clerkPublishableKey = env.VITE_CLERK_PUBLISHABLE_KEY ?? nextPublicClerkPublishableKey;
  const sentryDsn = env.VITE_SENTRY_DSN ?? env.NEXT_PUBLIC_SENTRY_DSN ?? env.SENTRY_DSN ?? '';
  const sentryEnvironment = env.VITE_SENTRY_ENVIRONMENT ?? env.SENTRY_ENVIRONMENT ?? mode;
  const sentryTracesSampleRate = clampSampleRate(
    env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? env.SENTRY_TRACES_SAMPLE_RATE,
    mode === 'production' ? 0.1 : 1,
  );
  if (process.env.LUMEN_REQUIRE_PUBLIC_CONFIG === '1') {
    const missing = [
      !clerkPublishableKey.trim() ? 'VITE_CLERK_PUBLISHABLE_KEY' : '',
      !sentryDsn.trim() ? 'VITE_SENTRY_DSN' : '',
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new Error(`required frontend build configuration is missing: ${missing.join(', ')}`);
    }
  }
  const publicBuildConfig = {
    mode,
    nextPublicAgentUrl,
    nextPublicSentryDsn,
    nextPublicClerkPublishableKey,
    clerkPublishableKey,
    sentryDsn,
    sentryEnvironment,
    sentryTracesSampleRate,
    releaseAssetBase: isReleaseBuild ? releaseAssetBase : '',
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
    releaseHtmlAssetPlugin(isReleaseBuild ? releaseAssetBase : ''),
    buildMetadataPlugin({
      schemaVersion: 1,
      release: frontendRelease,
      assetBase: releaseAssetBase,
      buildConfigFingerprint: fingerprintPublicBuildConfig(publicBuildConfig),
    }),
  ];

  return {
    base: releaseAssetBase,
    envDir: __dirname,
    plugins,
    resolve: {
      alias: [
        { find: '@app', replacement: path.resolve(__dirname, 'src') },
        {
          find: '@/i18n/messages',
          replacement: path.resolve(__dirname, 'src/i18n/messages.ts'),
        },
        {
          find: '@/i18n/provider',
          replacement: path.resolve(__dirname, 'src/i18n/provider.tsx'),
        },
        {
          find: '@/i18n/routing',
          replacement: path.resolve(__dirname, 'src/i18n/routing.ts'),
        },
        {
          find: '@/components/home/AuroraBackdrop',
          replacement: path.resolve(__dirname, 'src/components/shell/AuroraBackdrop.tsx'),
        },
        {
          find: '@/components/home/NotificationsPopover',
          replacement: path.resolve(__dirname, 'src/components/shell/NotificationsPopover.tsx'),
        },
        {
          find: '@/components/home/Topbar',
          replacement: path.resolve(__dirname, 'src/components/shell/Topbar.tsx'),
        },
        {
          find: '@/components/i18n/LanguageToggle',
          replacement: path.resolve(__dirname, 'src/components/shell/LanguageToggle.tsx'),
        },
        {
          find: '@/components/mobile/MobileSheet',
          replacement: path.resolve(__dirname, 'src/components/shell/MobileSheet.tsx'),
        },
        {
          find: '@/components/mobile/SafeAreaContainer',
          replacement: path.resolve(__dirname, 'src/components/shell/SafeAreaContainer.tsx'),
        },
        {
          find: '@/components/ui/LumenMark',
          replacement: path.resolve(__dirname, 'src/components/shell/LumenMark.tsx'),
        },
        {
          find: '@/components/voice/VoiceInputControl',
          replacement: path.resolve(__dirname, 'src/components/voice/VoiceInputControl.tsx'),
        },
        {
          find: '@/hooks/use-is-mobile',
          replacement: path.resolve(__dirname, 'src/hooks/use-is-mobile.ts'),
        },
        {
          find: '@/hooks/use-media-query',
          replacement: path.resolve(__dirname, 'src/hooks/use-media-query.ts'),
        },
        {
          find: '@/hooks/use-speech-to-text',
          replacement: path.resolve(__dirname, 'src/hooks/use-speech-to-text.ts'),
        },
        {
          find: '@/lib/app-shell-chrome',
          replacement: path.resolve(__dirname, 'src/lib/app-shell-chrome.tsx'),
        },
        {
          find: '@/lib/auth-redirect',
          replacement: path.resolve(__dirname, 'src/lib/auth-redirect.ts'),
        },
        { find: '@/lib/cn', replacement: path.resolve(__dirname, 'src/lib/cn.ts') },
        {
          find: '@/lib/protected-paths',
          replacement: path.resolve(__dirname, 'src/lib/protected-paths.ts'),
        },
        {
          find: '@/lib/release-asset-url',
          replacement: path.resolve(__dirname, 'src/lib/release-asset-url.ts'),
        },
        { find: '@', replacement: path.resolve(__dirname, 'src') },
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
      'process.env.NEXT_PUBLIC_AGENT_URL': JSON.stringify(nextPublicAgentUrl),
      'process.env.NEXT_PUBLIC_SENTRY_DSN': JSON.stringify(nextPublicSentryDsn),
      'process.env.NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY': JSON.stringify(
        nextPublicClerkPublishableKey,
      ),
      __LUMEN_CLERK_PUBLISHABLE_KEY__: JSON.stringify(clerkPublishableKey),
      __LUMEN_SENTRY_DSN__: JSON.stringify(sentryDsn),
      __LUMEN_SENTRY_ENVIRONMENT__: JSON.stringify(sentryEnvironment),
      // Browser tracesSampleRate: a hardcoded 1.0 sent every fetch / SSE
      // request as a Sentry transaction, which floods quota and adds
      // instrumentation overhead on hot paths. Default to 0.1 in prod,
      // 1.0 in dev/preview, with explicit override via env when needed.
      __LUMEN_SENTRY_TRACES_SAMPLE_RATE__: JSON.stringify(sentryTracesSampleRate),
      __LUMEN_RELEASE_ASSET_BASE__: JSON.stringify(isReleaseBuild ? releaseAssetBase : ''),
    },
    build: {
      outDir: 'dist',
      manifest: true,
      sourcemap: 'hidden',
      chunkSizeWarningLimit: 1000,
      rollupOptions: {
        input: {
          app: path.resolve(__dirname, 'index.html'),
          auth: path.resolve(__dirname, 'auth.html'),
          authZh: path.resolve(__dirname, 'auth-zh.html'),
          landing: path.resolve(__dirname, 'landing.html'),
          landingZh: path.resolve(__dirname, 'landing-zh.html'),
          notFound: path.resolve(__dirname, 'not-found.html'),
          notFoundZh: path.resolve(__dirname, 'not-found-zh.html'),
          share: path.resolve(__dirname, 'share.html'),
        },
        output: {
          manualChunks,
        },
      },
    },
    server: {
      port: 3002,
      proxy: {
        '/app/api': {
          target: 'http://localhost:3000',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/app/, ''),
        },
        '/api': 'http://localhost:3000',
        '/v1/agent': 'http://localhost:3001',
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
