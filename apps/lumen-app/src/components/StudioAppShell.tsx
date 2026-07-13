'use client';

import { useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { AppShellChromeProvider } from '../lib/app-shell-chrome';
import { isCanvasShellRoute } from '../lib/app-shell-routes';
import { AuroraBackdrop } from './shell/AuroraBackdrop';
import { Topbar } from './shell/Topbar';

export function StudioAppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const isCanvasRoute = isCanvasShellRoute(location.pathname);

  return (
    <div className="relative min-h-screen text-white">
      {!isCanvasRoute ? <AuroraBackdrop /> : null}
      {!isCanvasRoute ? <Topbar /> : null}
      <AppShellChromeProvider enabled>{children}</AppShellChromeProvider>
    </div>
  );
}
