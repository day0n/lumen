import { createFileRoute } from '@tanstack/react-router';
import { CanvasRoute } from '../features/canvas/CanvasRoute';

export const Route = createFileRoute('/canvas/new')({
  component: CanvasNewRoute,
});

function CanvasNewRoute() {
  return <CanvasRoute createOnMount />;
}
