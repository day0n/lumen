'use client';

import { cn } from '@/lib/cn';
import { DASHBOARD_FADE } from '@/lib/dashboard-motion';
import { IconSparkles, IconTargetArrow, IconTrendingUp } from '@tabler/icons-react';
import { motion } from 'motion/react';
import type { DashboardSectionTarget } from './constants';

export interface DashboardInsight {
  id: string;
  title: string;
  detail: string;
  target: DashboardSectionTarget;
  accent: string;
}

export function DashboardInsightBar({
  insights,
  activeTarget,
  onSelect,
  reducedMotion,
}: {
  insights: DashboardInsight[];
  activeTarget: DashboardSectionTarget | null;
  onSelect: (target: DashboardSectionTarget) => void;
  reducedMotion: boolean;
}) {
  if (insights.length === 0) return null;

  const icons = [IconTrendingUp, IconTargetArrow, IconSparkles];

  return (
    <div className="mb-4 flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {insights.map((insight, index) => {
        const Icon = icons[index % icons.length] ?? IconSparkles;
        const active = activeTarget === insight.target;
        return (
          <motion.button
            key={insight.id}
            type="button"
            onClick={() => onSelect(insight.target)}
            initial={reducedMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ ...DASHBOARD_FADE, delay: reducedMotion ? 0 : index * 0.06 }}
            className={cn(
              'group min-w-[220px] max-w-[320px] shrink-0 rounded-xl px-3 py-2.5 text-left ring-1 transition-[box-shadow,background-color]',
              active
                ? 'bg-[#14313a] ring-[#79e4ff]/28 shadow-[0_0_24px_rgba(121,228,255,0.12)]'
                : 'bg-[#151719]/78 ring-white/[0.08] hover:bg-white/[0.04] hover:ring-white/[0.14]',
            )}
          >
            <span className="flex items-start gap-2">
              <span
                className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg ring-1"
                style={{
                  color: insight.accent,
                  backgroundColor: `${insight.accent}18`,
                  boxShadow: `inset 0 0 0 1px ${insight.accent}33`,
                }}
              >
                <Icon size={14} stroke={2.2} />
              </span>
              <span className="min-w-0">
                <span className="block truncate text-[12px] font-bold text-white/88">
                  {insight.title}
                </span>
                <span className="mt-0.5 line-clamp-2 text-[11px] leading-4 text-white/40">
                  {insight.detail}
                </span>
              </span>
            </span>
          </motion.button>
        );
      })}
    </div>
  );
}
