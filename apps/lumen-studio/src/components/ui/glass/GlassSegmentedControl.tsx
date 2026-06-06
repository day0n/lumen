'use client';

import { DASHBOARD_SPRING } from '@/lib/dashboard-motion';
import { cn } from '@/lib/cn';
import { motion } from 'motion/react';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { useGlassLensFilter } from './useGlassLensFilter';

type SegmentedOption<T extends string> = {
  label: string;
  value: T;
};

type GlassSegmentedControlProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  spacious?: boolean;
  reducedMotion?: boolean;
};

type IndicatorRect = {
  left: number;
  width: number;
  height: number;
};

const LENS_HEIGHT = 44;
const LENS_RADIUS = 10;

export function GlassSegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  spacious = false,
  reducedMotion = false,
}: GlassSegmentedControlProps<T>) {
  const containerRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef(new Map<T, HTMLButtonElement>());
  const [indicator, setIndicator] = useState<IndicatorRect>({
    left: 0,
    width: 0,
    height: LENS_HEIGHT,
  });

  const lensWidth = Math.max(indicator.width, 48);
  const { filterStyle, FilterDefs } = useGlassLensFilter({
    width: Math.round(lensWidth),
    height: LENS_HEIGHT,
    borderRadius: LENS_RADIUS,
    scale: 0.12,
    depth: 12,
    curvature: 42,
    filterScale: 10,
    chroma: 0.16,
  });

  const measureIndicator = useCallback(() => {
    const container = containerRef.current;
    const activeButton = itemRefs.current.get(value);
    if (!container || !activeButton) return;

    const containerRect = container.getBoundingClientRect();
    const buttonRect = activeButton.getBoundingClientRect();
    setIndicator({
      left: buttonRect.left - containerRect.left,
      width: buttonRect.width,
      height: buttonRect.height,
    });
  }, [value]);

  useLayoutEffect(() => {
    measureIndicator();
  }, [measureIndicator, options, spacious]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => measureIndicator());
    observer.observe(container);
    for (const button of itemRefs.current.values()) {
      observer.observe(button);
    }

    return () => observer.disconnect();
  }, [measureIndicator, options, value]);

  const showLens = indicator.width > 0 && !reducedMotion;

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'relative grid rounded-lg bg-white/[0.045] p-1 ring-1 ring-white/[0.06]',
        spacious ? 'grid-cols-2 gap-1 md:grid-cols-4' : 'grid-cols-4',
      )}
    >
      {FilterDefs ? <FilterDefs /> : null}

      {showLens ? (
        <>
          <motion.div
            aria-hidden
            className="pointer-events-none absolute top-1 z-0 overflow-hidden rounded-[10px] bg-white shadow-[0_10px_28px_-14px_rgba(255,255,255,0.85)]"
            initial={false}
            animate={{
              left: indicator.left,
              width: indicator.width,
              height: indicator.height,
            }}
            transition={DASHBOARD_SPRING}
            style={{
              filter: filterStyle,
              willChange: 'left, width',
            }}
          />
          <motion.div
            aria-hidden
            className="pointer-events-none absolute top-1 z-[1] rounded-[10px]"
            initial={false}
            animate={{
              left: indicator.left,
              width: indicator.width,
              height: indicator.height,
            }}
            transition={DASHBOARD_SPRING}
            style={{
              background:
                'linear-gradient(135deg, rgba(255,255,255,0.55) 0%, rgba(255,255,255,0.08) 38%, transparent 58%, rgba(255,255,255,0.12) 100%)',
              boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.72), inset 0 -1px 0 rgba(0,0,0,0.06)',
            }}
          />
        </>
      ) : indicator.width > 0 ? (
        <motion.div
          aria-hidden
          className="pointer-events-none absolute top-1 z-0 rounded-md bg-white"
          initial={false}
          animate={{
            left: indicator.left,
            width: indicator.width,
            height: indicator.height,
          }}
          transition={reducedMotion ? { duration: 0 } : DASHBOARD_SPRING}
        />
      ) : null}

      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            ref={(node) => {
              if (node) itemRefs.current.set(option.value, node);
              else itemRefs.current.delete(option.value);
            }}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'relative z-[2] min-h-11 rounded-md px-3 text-[12px] font-semibold transition-colors duration-200',
              active ? 'text-[#111315]' : 'text-white/48 hover:text-white/80',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
