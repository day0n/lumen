'use client';

import { SafeAreaContainer } from '@/components/mobile/SafeAreaContainer';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

interface MobileTopbarProps {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  className?: string;
}

/** Compact sticky header for mobile-only sub-pages (lg:hidden wrapper). */
export function MobileTopbar({ left, center, right, className }: MobileTopbarProps) {
  return (
    <SafeAreaContainer
      edges="top"
      as="header"
      className={cn(
        'sticky top-0 z-30 flex h-14 min-h-[56px] items-center gap-2 border-b border-white/[0.06] bg-[#111315]/95 px-4 backdrop-blur-xl lg:hidden',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2">{left}</div>
      {center ? <div className="min-w-0 flex-[2] text-center">{center}</div> : null}
      <div className="flex shrink-0 items-center justify-end gap-2">{right}</div>
    </SafeAreaContainer>
  );
}
