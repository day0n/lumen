'use client';

import type { Locale } from '@/i18n/routing';
import { cn } from '@/lib/cn';
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
          'h-1.5 w-full cursor-pointer appearance-none rounded-full bg-white/[0.08]',
          '[&::-webkit-slider-thumb]:h-3.5 [&::-webkit-slider-thumb]:w-3.5 [&::-webkit-slider-thumb]:appearance-none',
          '[&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#79e4ff]',
          '[&::-webkit-slider-thumb]:shadow-[0_0_12px_rgba(121,228,255,0.55)]',
          '[&::-moz-range-thumb]:h-3.5 [&::-moz-range-thumb]:w-3.5 [&::-moz-range-thumb]:rounded-full',
          '[&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-[#79e4ff]',
        )}
        aria-valuetext={`${activePoint.label} ${formatCurrency(activePoint.revenue, locale)}`}
      />
      <div className="mt-2 flex justify-between text-[10px] text-white/28">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </div>
  );
}
