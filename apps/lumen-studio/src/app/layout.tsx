import { localePath } from '@/i18n/routing';
import { getRequestLocale } from '@/i18n/server';
import { zhCN } from '@clerk/localizations';
import { ClerkProvider } from '@clerk/nextjs';
import { ColorSchemeScript } from '@mantine/core';
import type { Metadata, Viewport } from 'next';
import { Inter, Manrope } from 'next/font/google';
import { Providers } from './providers';
import '@mantine/core/styles.css';
import '@xyflow/react/dist/style.css';
import './globals.css';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-inter',
  display: 'swap',
});

const display = Manrope({
  subsets: ['latin'],
  variable: '--font-display',
  display: 'swap',
  weight: ['600', '700', '800'],
});

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getRequestLocale();
  return {
    title:
      locale === 'zh'
        ? 'Lumen — 把商品变成爆款带货视频'
        : 'Lumen — Turn products into videos that sell',
    description:
      locale === 'zh'
        ? 'Lumen 是面向 TikTok Shop 商家的 AIGC 带货视频生成系统。粘贴商品链接，AI 在画布上自动搭工作流出片。'
        : 'Lumen is an AI video creation studio for TikTok Shop sellers. Paste a product link and let AI assemble a workflow on canvas.',
    applicationName: 'Lumen',
  };
}

export const viewport: Viewport = {
  themeColor: '#0c0a07',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

function getExternalResourceOrigins(): string[] {
  const origins = new Set(['https://clerk.lumenstudio.tech', 'https://img.clerk.com']);
  const r2PublicBaseUrl = process.env.R2_PUBLIC_BASE_URL?.trim();

  if (r2PublicBaseUrl) {
    try {
      origins.add(new URL(r2PublicBaseUrl).origin);
    } catch {}
  }

  return [...origins];
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getRequestLocale();
  const externalOrigins = getExternalResourceOrigins();

  return (
    <html
      lang={locale === 'zh' ? 'zh-CN' : 'en'}
      className={`${inter.variable} ${display.variable}`}
      suppressHydrationWarning
    >
      <head>
        <ColorSchemeScript defaultColorScheme="dark" forceColorScheme="dark" />
        {externalOrigins.map((origin) => (
          <link key={`dns-prefetch:${origin}`} rel="dns-prefetch" href={origin} />
        ))}
        {externalOrigins.map((origin) => (
          <link key={`preconnect:${origin}`} rel="preconnect" href={origin} crossOrigin="" />
        ))}
      </head>
      <body>
        <ClerkProvider
          localization={locale === 'zh' ? (zhCN as never) : undefined}
          signInUrl={localePath('/sign-in', locale)}
          signUpUrl={localePath('/sign-up', locale)}
          signInFallbackRedirectUrl={localePath('/', locale)}
          signUpFallbackRedirectUrl={localePath('/', locale)}
        >
          <Providers initialLocale={locale}>{children}</Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
