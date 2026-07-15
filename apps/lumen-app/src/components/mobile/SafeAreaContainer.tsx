'use client';

import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';

type SafeAreaEdge = 'top' | 'bottom' | 'left' | 'right' | 'x' | 'y' | 'all';

const PADDING: Record<SafeAreaEdge, string> = {
  top: 'pt-[max(0px,env(safe-area-inset-top))]',
  bottom: 'pb-[max(0px,env(safe-area-inset-bottom))]',
  left: 'pl-[max(0px,env(safe-area-inset-left))]',
  right: 'pr-[max(0px,env(safe-area-inset-right))]',
  x: 'px-[max(0px,env(safe-area-inset-left))] pr-[max(0px,env(safe-area-inset-right))]',
  y: 'pt-[max(0px,env(safe-area-inset-top))] pb-[max(0px,env(safe-area-inset-bottom))]',
  all: 'pt-[max(0px,env(safe-area-inset-top))] pr-[max(0px,env(safe-area-inset-right))] pb-[max(0px,env(safe-area-inset-bottom))] pl-[max(0px,env(safe-area-inset-left))]',
};

interface SafeAreaContainerProps {
  children?: ReactNode;
  className?: string;
  edges?: SafeAreaEdge;
  as?: 'div' | 'main' | 'section' | 'footer' | 'header';
}

export function SafeAreaContainer({
  children,
  className,
  edges = 'bottom',
  as: Tag = 'div',
}: SafeAreaContainerProps) {
  return <Tag className={cn(PADDING[edges], className)}>{children}</Tag>;
}
