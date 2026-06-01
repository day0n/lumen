'use client';

import type { Locale } from '@/i18n/routing';
import { I18nProvider } from '@/i18n/provider';
import { lumenTheme } from '@/lib/theme';
import { ColorSchemeScript, MantineProvider } from '@mantine/core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Provider as JotaiProvider } from 'jotai';
import { type ReactNode, useState } from 'react';

export function Providers({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  return (
    <MantineProvider theme={lumenTheme} defaultColorScheme="dark" forceColorScheme="dark">
      <JotaiProvider>
        <QueryClientProvider client={queryClient}>
          <I18nProvider initialLocale={initialLocale}>{children}</I18nProvider>
        </QueryClientProvider>
      </JotaiProvider>
    </MantineProvider>
  );
}

export { ColorSchemeScript };
