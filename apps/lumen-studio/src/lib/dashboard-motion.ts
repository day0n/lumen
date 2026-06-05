'use client';

import { useEffect, useState } from 'react';

export const DASHBOARD_EASE = [0.22, 1, 0.36, 1] as const;
export const DASHBOARD_EASE_OUT = [0.32, 0.72, 0, 1] as const;
export const DASHBOARD_SPRING = { type: 'spring' as const, stiffness: 280, damping: 32 };
export const DASHBOARD_FADE = { duration: 0.35, ease: DASHBOARD_EASE };
export const DASHBOARD_CROSSFADE = { duration: 0.42, ease: DASHBOARD_EASE_OUT };

export function useDashboardReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return reducedMotion;
}

export function useElectricPulse(durationMs = 2800) {
  const [active, setActive] = useState(false);

  const pulse = () => {
    setActive(true);
    window.setTimeout(() => setActive(false), durationMs);
  };

  return { active, pulse };
}
