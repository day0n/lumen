'use client';

import { type ReactNode, createContext, useContext } from 'react';

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
