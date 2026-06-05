'use client';

import { cn } from '@/lib/cn';
import type { ReactNode } from 'react';
import { DashboardReveal } from './DashboardReveal';
import { ElectricBorder } from './ElectricBorder';
import { SpotlightCard } from './SpotlightCard';

export function DashboardPanel({
  children,
  className,
  delay = 0,
  electric = false,
  spotlightColor = 'rgba(121, 228, 255, 0.18)',
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  electric?: boolean;
  spotlightColor?: string;
}) {
  const panel = (
    <SpotlightCard
      spotlightColor={spotlightColor}
      className={cn(
        'rounded-xl bg-[#151719]/88 p-4 ring-1 ring-white/[0.08] backdrop-blur-sm',
        className,
      )}
    >
      {children}
    </SpotlightCard>
  );

  const body = electric ? (
    <ElectricBorder color="#79e4ff" borderRadius={16} speed={0.75} chaos={0.09} className="rounded-xl">
      {panel}
    </ElectricBorder>
  ) : (
    panel
  );

  return <DashboardReveal delay={delay}>{body}</DashboardReveal>;
}
