import { createFileRoute } from '@tanstack/react-router';
import { Suspense, lazy } from 'react';
import { RouteLoader } from '../features/routing/RouteLoader';

const WorkspacePage = lazy(() =>
  import('@/components/studio/WorkspacePage').then((module) => ({
    default: module.WorkspacePage,
  })),
);

export const Route = createFileRoute('/projects')({
  component: ProjectsRoute,
});

function ProjectsRoute() {
  return (
    <Suspense fallback={<RouteLoader />}>
      <WorkspacePage />
    </Suspense>
  );
}
