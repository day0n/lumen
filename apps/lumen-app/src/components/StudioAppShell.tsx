'use client';

import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { Topbar } from '@/components/home/Topbar';
import { AppShellChromeProvider } from '@/lib/app-shell-chrome';
import { useLocation } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export function StudioAppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const isCanvasRoute =
    location.pathname === '/canvas/new' || location.pathname.startsWith('/canvas/');

  return (
    <div className="relative min-h-screen text-white">
      {!isCanvasRoute ? <AuroraBackdrop /> : null}
      {!isCanvasRoute ? <Topbar /> : null}
      <AppShellChromeProvider enabled={!isCanvasRoute}>{children}</AppShellChromeProvider>
    </div>
  );
}
