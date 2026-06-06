'use client';

import { CanvasDotLogo } from '@/components/canvas/CanvasDotLogo';
import { CanvasRotatingLabel } from '@/components/canvas/CanvasRotatingLabel';
import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/cn';
import { useMemo } from 'react';

export function CanvasEntryLoader({
  className,
  'aria-label': ariaLabel,
}: {
  className?: string;
  'aria-label'?: string;
}) {
  const { t } = useI18n();
  const messages = useMemo(
    () => [t('canvas.entry.opening'), t('canvas.entry.loadingNodes'), t('canvas.entry.preparingCanvas')],
    [t],
  );

  return (
    <div
      className={cn(
        'flex h-full min-h-dvh w-full flex-col items-center justify-center bg-[#030304]',
        className,
      )}
      role="status"
      aria-busy="true"
      aria-live="polite"
      aria-label={ariaLabel ?? messages[0]}
    >
      <div className="flex animate-in fade-in items-center justify-center gap-2.5 duration-300 ease-out">
        <CanvasDotLogo size="md" />
        <CanvasRotatingLabel messages={messages} />
      </div>
    </div>
  );
}
