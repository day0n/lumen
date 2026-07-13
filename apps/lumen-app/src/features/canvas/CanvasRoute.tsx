'use client';

import '@xyflow/react/dist/style.css';
import { stripCanvasEntryLoaderSearch } from '@/components/canvas/canvas-entry-loader';
import { Suspense, lazy, useEffect } from 'react';
import { StudioProviders } from '../../providers/studio-providers';
import { CanvasRouteFallback } from './CanvasRouteFallback';

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
      <Suspense fallback={<CanvasRouteFallback />}>
        <CanvasWorkbench projectId={projectId} createOnMount={createOnMount} />
      </Suspense>
    </StudioProviders>
  );
}
