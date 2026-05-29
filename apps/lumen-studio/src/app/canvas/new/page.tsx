import { Suspense } from 'react';

import { CanvasWorkbench } from '@/components/canvas/CanvasWorkbench';

export default function CanvasNewPage() {
  return (
    <Suspense fallback={null}>
      <CanvasWorkbench createOnMount />
    </Suspense>
  );
}
