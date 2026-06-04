'use client';

import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

interface ResponsiveGridProps {
  children: ReactNode;
  className?: string;
  /** 1 col mobile, 2 sm, 3 lg, 4 xl */
  variant?: 'cards' | 'dense' | 'kpi';
}

const VARIANTS: Record<NonNullable<ResponsiveGridProps['variant']>, string> = {
  cards: 'grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
  dense: 'grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3',
  kpi: 'grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-4',
};

export function ResponsiveGrid({ children, className, variant = 'cards' }: ResponsiveGridProps) {
  return <div className={cn(VARIANTS[variant], className)}>{children}</div>;
}
