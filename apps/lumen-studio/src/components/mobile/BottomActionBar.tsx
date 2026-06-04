'use client';

import { SafeAreaContainer } from '@/components/mobile/SafeAreaContainer';
import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

interface BottomActionBarProps {
  children: ReactNode;
  className?: string;
}

/** Fixed bottom bar with safe-area; use on mobile canvas / sheets footers. */
export function BottomActionBar({ children, className }: BottomActionBarProps) {
  return (
    <SafeAreaContainer
      edges="bottom"
      as="footer"
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t border-white/[0.08] bg-[#111315]/95 px-4 py-3 backdrop-blur-xl',
        className,
      )}
    >
      {children}
    </SafeAreaContainer>
  );
}
