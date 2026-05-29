import { Suspense } from 'react';

import { CanvasWorkbench } from '@/components/canvas/CanvasWorkbench';

interface CanvasProjectPageProps {
  params: Promise<{
    projectId: string;
  }>;
}

export default async function CanvasProjectPage({ params }: CanvasProjectPageProps) {
  const { projectId } = await params;
  return (
    <Suspense fallback={null}>
      <CanvasWorkbench projectId={projectId} />
    </Suspense>
  );
}
