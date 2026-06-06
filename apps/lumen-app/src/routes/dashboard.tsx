import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';
import { RouteLoader } from '../features/routing/RouteLoader';

const DashboardPage = lazy(() =>
  import('@/components/studio/DashboardPage').then((module) => ({
    default: module.DashboardPage,
  })),
);

export const Route = createFileRoute('/dashboard')({
  component: DashboardRoute,
});

function DashboardRoute() {
  return (
    <Suspense fallback={<RouteLoader />}>
      <DashboardPage />
    </Suspense>
  );
}
