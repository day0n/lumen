import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';
import { RouteLoader } from '../features/routing/RouteLoader';

const MaterialsPage = lazy(() =>
  import('@/components/studio/MaterialsPage').then((module) => ({
    default: module.MaterialsPage,
  })),
);

export const Route = createFileRoute('/materials')({
  component: MaterialsRoute,
});

function MaterialsRoute() {
  return (
    <Suspense fallback={<RouteLoader />}>
      <MaterialsPage />
    </Suspense>
  );
}
