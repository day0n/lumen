import { Suspense, lazy } from 'react';
import { StudioProviders } from '../../providers/studio-providers';

const CanvasWorkbench = lazy(() =>
  import('@/components/canvas/CanvasWorkbench').then((mod) => ({
    default: mod.CanvasWorkbench,
  })),
);

export function CanvasRoute({
  projectId,
  createOnMount = false,
}: {
  projectId?: string;
  createOnMount?: boolean;
}) {
  return (
    <StudioProviders>
      <Suspense fallback={<CanvasShellFallback />}>
        <CanvasWorkbench projectId={projectId} createOnMount={createOnMount} />
      </Suspense>
    </StudioProviders>
  );
}

function CanvasShellFallback() {
  return <div className="min-h-dvh bg-[#0b0d10]" />;
}
