'use client';

import { cn } from '@/lib/cn';
import { LumenMark } from './LumenMark';

export function LumenWordmark({
  className,
  markClassName,
  markSize = 26,
  wordClassName,
}: {
  className?: string;
  markClassName?: string;
  markSize?: number;
  wordClassName?: string;
}) {
  return (
    <span className={cn('inline-flex items-center gap-3', className)}>
      <LumenMark className={markClassName} size={markSize} />
      <span className={cn('lumen-wordmark leading-none text-white', wordClassName)}>Lumen</span>
    </span>
  );
}
