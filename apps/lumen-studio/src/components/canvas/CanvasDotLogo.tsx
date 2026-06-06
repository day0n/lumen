'use client';

import { cn } from '@/lib/cn';
import { useEffect, useMemo, useState } from 'react';

const LOGO_FRAMES = [
  `
00000
00000
00100
00000
00000
`,
  `
00000
00100
01010
00100
00000
`,
  `
00000
01110
01010
01110
00000
`,
  `
00100
01110
11011
01110
00100
`,
  `
00100
01110
11011
01110
00100
`,
  `
00000
01110
01010
01110
00000
`,
  `
00000
00100
01010
00100
00000
`,
] as const;

const FRAME_INTERVAL_MS = 200;

const sizeClasses = {
  sm: 'size-[18px] gap-px',
  md: 'size-7 gap-0.5',
  lg: 'size-9 gap-0.5',
} as const;

export function CanvasDotLogo({
  className,
  size = 'md',
  paused = false,
}: {
  className?: string;
  size?: keyof typeof sizeClasses;
  paused?: boolean;
}) {
  const [frameIndex, setFrameIndex] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  const shouldAnimate = !paused && !reducedMotion;

  useEffect(() => {
    if (!shouldAnimate) return;
    const intervalId = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % LOGO_FRAMES.length);
    }, FRAME_INTERVAL_MS);
    return () => window.clearInterval(intervalId);
  }, [shouldAnimate]);

  const cells = useMemo(() => {
    const frame = LOGO_FRAMES[shouldAnimate ? frameIndex : 0] ?? LOGO_FRAMES[0];
    return frame
      .trim()
      .split('\n')
      .flatMap((row) => row.split(''));
  }, [frameIndex, shouldAnimate]);

  return (
    <div
      aria-hidden
      className={cn('grid aspect-square shrink-0 grid-cols-5 grid-rows-5', sizeClasses[size], className)}
    >
      {cells.map((cell, index) => (
        <span
          key={`${frameIndex}-${index}`}
          className="block size-full rounded-full bg-white"
          style={{ opacity: cell === '1' ? 0.88 : 0.08 }}
        />
      ))}
    </div>
  );
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  return reducedMotion;
}
