import { createFileRoute, useParams } from '@tanstack/react-router';
import { CanvasRoute } from '../features/canvas/CanvasRoute';

export const Route = createFileRoute('/canvas/$projectId')({
  component: CanvasProjectRoute,
});

function CanvasProjectRoute() {
  const { projectId } = useParams({ from: '/canvas/$projectId' }) as {
    projectId: string;
  };
  return <CanvasRoute projectId={projectId} />;
}
