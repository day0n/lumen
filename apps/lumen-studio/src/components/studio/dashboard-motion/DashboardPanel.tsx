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
  spotlight = false,
  spotlightColor = 'rgba(121, 228, 255, 0.18)',
  skipReveal = false,
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  electric?: boolean;
  /** Spotlight follows pointer — use sparingly on hero panels only. */
  spotlight?: boolean;
  spotlightColor?: string;
  skipReveal?: boolean;
}) {
  const shell = (
    <div
      className={cn(
        'rounded-xl bg-[#151719]/88 p-4 ring-1 ring-white/[0.08] backdrop-blur-sm',
        className,
      )}
    >
      {children}
    </div>
  );

  const panel = spotlight ? (
    <SpotlightCard spotlightColor={spotlightColor} className="rounded-xl">
      {shell}
    </SpotlightCard>
  ) : (
    shell
  );

  const body = electric ? (
    <ElectricBorder color="#79e4ff" borderRadius={16} speed={0.75} chaos={0.09} className="rounded-xl">
      {panel}
    </ElectricBorder>
  ) : (
    panel
  );

  if (skipReveal) return body;
  return <DashboardReveal delay={delay}>{body}</DashboardReveal>;
}
