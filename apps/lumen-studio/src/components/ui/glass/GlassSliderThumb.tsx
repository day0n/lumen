'use client';

import { cn } from '@/lib/cn';
import { useGlassLensFilter } from './useGlassLensFilter';

const THUMB_SIZE = 22;
const THUMB_RADIUS = 11;

type GlassSliderThumbProps = {
  percent: number;
  reducedMotion?: boolean;
  className?: string;
};

export function GlassSliderThumb({ percent, reducedMotion = false, className }: GlassSliderThumbProps) {
  const { filterStyle, FilterDefs } = useGlassLensFilter({
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    borderRadius: THUMB_RADIUS,
    scale: 0.14,
    depth: 8,
    curvature: 48,
    filterScale: 12,
    chroma: 0.22,
  });

  return (
    <>
      {FilterDefs ? <FilterDefs /> : null}
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute top-1/2 z-[1] -translate-x-1/2 -translate-y-1/2 rounded-full',
          className,
        )}
        style={{
          left: `${percent}%`,
          width: THUMB_SIZE,
          height: THUMB_SIZE,
          filter: reducedMotion ? undefined : filterStyle,
          background: reducedMotion
            ? '#79e4ff'
            : 'linear-gradient(145deg, rgba(255,255,255,0.92) 0%, rgba(121,228,255,0.88) 52%, rgba(90,200,235,0.95) 100%)',
          boxShadow: reducedMotion
            ? '0 0 12px rgba(121,228,255,0.55)'
            : '0 0 16px rgba(121,228,255,0.45), inset 0 1px 0 rgba(255,255,255,0.85), inset 0 -1px 0 rgba(0,0,0,0.08)',
          transition: reducedMotion ? undefined : 'left 80ms linear',
        }}
      />
    </>
  );
}
