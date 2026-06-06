import { Outlet, createRootRoute } from '@tanstack/react-router';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { AppProviders } from '../providers/app-providers';

export const Route = createRootRoute({
  component: RootRoute,
});

function RootRoute() {
  return (
    <AppProviders>
      <ProtectedRoute>
        <Outlet />
      </ProtectedRoute>
    </AppProviders>
  );
}
