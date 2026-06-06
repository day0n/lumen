'use client';

import { stripCanvasEntryLoaderSearch } from '@/components/canvas/canvas-entry-loader';
import { CanvasEntryLoader } from '@/components/canvas/CanvasEntryLoader';
import { Suspense, lazy, useEffect } from 'react';
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
  useEffect(() => {
    stripCanvasEntryLoaderSearch();
  }, []);

  return (
    <StudioProviders>
      <Suspense fallback={<CanvasEntryLoader />}>
        <CanvasWorkbench projectId={projectId} createOnMount={createOnMount} />
      </Suspense>
    </StudioProviders>
  );
}
