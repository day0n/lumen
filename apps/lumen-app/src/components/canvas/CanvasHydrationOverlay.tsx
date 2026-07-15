'use client';

import { CanvasEntryLoader } from '@/components/canvas/CanvasEntryLoader';
import { motion } from 'motion/react';

interface CanvasHydrationOverlayProps {
  /** 主提示文案，例如「正在唤醒工作流」 */
  label: string;
  /** 副标题，例如「Loading nodes onto canvas」 */
  hint?: string;
}

export function warmCanvasHydrationOverlay() {
  if (typeof window === 'undefined') return Promise.resolve();
  return import('@/components/canvas/CanvasEntryLoader');
}

export function CanvasHydrationOverlay({ label, hint }: CanvasHydrationOverlayProps) {
  const ariaLabel = hint ? `${label}. ${hint}` : label;

  return (
    <motion.output
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
      className="pointer-events-auto absolute inset-0 z-[60] block overflow-hidden"
      aria-busy="true"
      aria-label={ariaLabel}
      aria-live="polite"
    >
      <CanvasEntryLoader className="min-h-0" aria-label={ariaLabel} />
    </motion.output>
  );
}
