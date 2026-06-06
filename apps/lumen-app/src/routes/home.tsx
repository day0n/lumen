import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';
import { RouteLoader } from '../features/routing/RouteLoader';

const StudioHomePage = lazy(() =>
  import('@/app/home/page').then((module) => ({
    default: module.default,
  })),
);

export const Route = createFileRoute('/home')({
  component: HomeRoute,
});

function HomeRoute() {
  return (
    <Suspense fallback={<RouteLoader />}>
      <StudioHomePage />
    </Suspense>
  );
}
