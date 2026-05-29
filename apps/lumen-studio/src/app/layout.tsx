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

export const metadata: Metadata = {
  title: 'Lumen — 把商品变成爆款带货视频',
  description:
    'Lumen 是面向 TikTok Shop 商家的 AIGC 带货视频生成系统。粘贴商品链接，AI 在画布上自动搭工作流出片。',
  applicationName: 'Lumen',
};

export const viewport: Viewport = {
  themeColor: '#0c0a07',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className={`${inter.variable} ${display.variable}`} suppressHydrationWarning>
      <head>
        <ColorSchemeScript defaultColorScheme="dark" forceColorScheme="dark" />
      </head>
      <body>
        <ClerkProvider>
          <Providers>{children}</Providers>
        </ClerkProvider>
      </body>
    </html>
  );
}
