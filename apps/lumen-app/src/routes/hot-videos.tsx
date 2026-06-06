import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';
import { RouteLoader } from '../features/routing/RouteLoader';

const HotVideosPage = lazy(() =>
  import('@/components/studio/HotVideosPage').then((module) => ({
    default: module.HotVideosPage,
  })),
);

export const Route = createFileRoute('/hot-videos')({
  component: HotVideosRoute,
});

function HotVideosRoute() {
  return (
    <Suspense fallback={<RouteLoader />}>
      <HotVideosPage />
    </Suspense>
  );
}
