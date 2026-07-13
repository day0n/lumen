import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';
import { RouteLoader } from '../features/routing/RouteLoader';

const HomePage = lazy(() =>
  import('../features/home/HomePage').then((module) => ({
    default: module.default,
  })),
);

export const Route = createFileRoute('/home')({
  component: HomeRoute,
});

function HomeRoute() {
  return (
    <Suspense fallback={<RouteLoader />}>
      <HomePage />
    </Suspense>
  );
}
