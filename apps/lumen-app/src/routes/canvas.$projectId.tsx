import { createFileRoute, useParams } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';
import { CanvasRouteFallback } from '../features/canvas/CanvasRouteFallback';

const CanvasRoute = lazy(() =>
  import('../features/canvas/CanvasRoute').then((module) => ({
    default: module.CanvasRoute,
  })),
);

export const Route = createFileRoute('/canvas/$projectId')({
  component: CanvasProjectRoute,
});

function CanvasProjectRoute() {
  const { projectId } = useParams({ from: '/canvas/$projectId' }) as {
    projectId: string;
  };
  return (
    <Suspense fallback={<CanvasRouteFallback />}>
      <CanvasRoute projectId={projectId} />
    </Suspense>
  );
}
