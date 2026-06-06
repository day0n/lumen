'use client';

import { createContext, useContext } from 'react';
import type { ReactNode } from 'react';

const AppShellChromeContext = createContext(false);

export function AppShellChromeProvider({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  return (
    <AppShellChromeContext.Provider value={enabled}>{children}</AppShellChromeContext.Provider>
  );
}

export function useAppShellChrome() {
  return useContext(AppShellChromeContext);
}
