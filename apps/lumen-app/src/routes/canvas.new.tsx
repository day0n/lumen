import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';
import { CanvasRouteFallback } from '../features/canvas/CanvasRouteFallback';

const CanvasRoute = lazy(() =>
  import('../features/canvas/CanvasRoute').then((module) => ({
    default: module.CanvasRoute,
  })),
);

export const Route = createFileRoute('/canvas/new')({
  component: CanvasNewRoute,
});

function CanvasNewRoute() {
  return (
    <Suspense fallback={<CanvasRouteFallback />}>
      <CanvasRoute createOnMount />
    </Suspense>
  );
}
