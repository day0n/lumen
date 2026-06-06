'use client';

import { GlassSliderThumb } from '@/components/ui/glass/GlassSliderThumb';
import { cn } from '@/lib/cn';
import type { Locale } from '@/i18n/routing';
import { DASHBOARD_FADE } from '@/lib/dashboard-motion';
import type { TiktokDailyPoint } from '@/lib/tiktok-dashboard-mock';
import { motion } from 'motion/react';
import { formatCurrency } from './utils';

export function DashboardTimeScrubber({
  points,
  index,
  locale,
  label,
  onChange,
  reducedMotion,
}: {
  points: TiktokDailyPoint[];
  index: number | null;
  locale: Locale;
  label: string;
  onChange: (index: number | null) => void;
  reducedMotion: boolean;
}) {
  if (points.length < 2) return null;

  const activeIndex = index ?? points.length - 1;
  const activePoint = points[activeIndex];
  if (!activePoint) return null;

  const percent = (activeIndex / (points.length - 1)) * 100;

  return (
    <div className="mt-3 rounded-lg bg-white/[0.03] px-3 py-3 ring-1 ring-white/[0.05]">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-wide text-white/32">
          {label}
        </span>
        <motion.span
          key={`${activePoint.date}-${activePoint.revenue}`}
          initial={reducedMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={DASHBOARD_FADE}
          className="text-[12px] font-bold text-[#79e4ff]"
        >
          {activePoint.label} · {formatCurrency(activePoint.revenue, locale)} ·{' '}
          {activePoint.roas.toFixed(2)}x
        </motion.span>
      </div>

      <div className="relative py-2">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-white/[0.08]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute left-0 top-1/2 h-1.5 -translate-y-1/2 rounded-full bg-gradient-to-r from-[#79e4ff]/35 to-[#79e4ff]/75"
          style={{ width: `${percent}%` }}
        />
        <GlassSliderThumb percent={percent} reducedMotion={reducedMotion} />
        <input
          type="range"
          min={0}
          max={points.length - 1}
          value={activeIndex}
          onChange={(event) => {
            const next = Number.parseInt(event.target.value, 10);
            onChange(next >= points.length - 1 ? null : next);
          }}
          className={cn(
            'relative z-[2] h-6 w-full cursor-pointer appearance-none bg-transparent',
            '[&::-webkit-slider-thumb]:h-[22px] [&::-webkit-slider-thumb]:w-[22px] [&::-webkit-slider-thumb]:appearance-none',
            '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-transparent',
            '[&::-webkit-slider-thumb]:shadow-none',
            '[&::-moz-range-thumb]:h-[22px] [&::-moz-range-thumb]:w-[22px] [&::-moz-range-thumb]:rounded-full',
            '[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-transparent',
          )}
          aria-valuetext={`${activePoint.label} ${formatCurrency(activePoint.revenue, locale)}`}
        />
      </div>

      <div className="mt-2 flex justify-between text-[10px] text-white/28">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}
