import { Outlet, createRootRoute } from '@tanstack/react-router';
import { StudioAppShell } from '../components/StudioAppShell';
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

