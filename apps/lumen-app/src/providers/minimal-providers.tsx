import { MantineProvider } from '@mantine/core';
import type { ReactNode } from 'react';
import { lumenTheme } from '../lib/theme';

export function MinimalProviders({ children }: { children: ReactNode }) {
  return (
    <MantineProvider theme={lumenTheme} defaultColorScheme="dark" forceColorScheme="dark">
      {children}
    </MantineProvider>
  );
}
