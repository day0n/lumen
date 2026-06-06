import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { Topbar } from '@/components/home/Topbar';
import { AppShellChromeProvider } from '@/lib/app-shell-chrome';
import { Outlet, createRootRoute } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { AppProviders } from '../providers/app-providers';

export const Route = createRootRoute({
  component: RootRoute,
});

function RootRoute() {
  return (
    <AppProviders>
      <StudioAppShell>
        <ProtectedRoute>
          <Outlet />
        </ProtectedRoute>
      </StudioAppShell>
    </AppProviders>
  );
}

function StudioAppShell({ children }: { children: ReactNode }) {
  return (
    <div className="relative min-h-screen text-white">
      <AuroraBackdrop />
      <Topbar />
      <AppShellChromeProvider enabled>{children}</AppShellChromeProvider>
    </div>
  );
}
