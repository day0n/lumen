'use client';

import { LanguageToggle } from '@/components/i18n/LanguageToggle';
import { APP_HOME_ROUTE } from '@/components/landing/useHomeRoutePreload';
import { LumenWordmark } from '@/components/ui/LumenWordmark';
import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/cn';
import { IconArrowRight } from '@tabler/icons-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

interface LandingNavProps {
  onHomeIntent?: () => void;
}

export function LandingNav({ onHomeIntent }: LandingNavProps) {
  const [scrolled, setScrolled] = useState(false);
  const { t, localePath } = useI18n();

  useEffect(() => {
    const updateScrolled = () => setScrolled(window.scrollY > 36);
    updateScrolled();
    window.addEventListener('scroll', updateScrolled, { passive: true });
    return () => window.removeEventListener('scroll', updateScrolled);
  }, []);

  return (
    <header
      className={cn(
        'pointer-events-none fixed inset-x-0 top-0 z-50 border-b border-white/[0.08] backdrop-blur-3xl transition-all duration-300',
        scrolled
          ? 'bg-[#050607]/[0.46] shadow-[0_20px_90px_rgba(255,255,255,0.10)]'
          : 'bg-[#050607]/[0.74]',
      )}
    >
      <div
        aria-hidden
        className={cn(
          'pointer-events-none absolute left-1/2 top-1/2 h-9 w-[300px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.18] blur-3xl transition-opacity duration-300',
          scrolled ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div className="pointer-events-auto relative mx-auto flex min-h-[50px] max-w-[1280px] items-center justify-between gap-3 px-4 pt-[max(0px,env(safe-area-inset-top))] sm:gap-4 sm:px-10 lg:px-[52px]">
        <Link href={localePath('/')} aria-label={t('landing.homeAria')}>
          <LumenWordmark markSize={20} wordClassName="text-[22px]" />
        </Link>

        <div className="flex items-center gap-2">
          <LanguageToggle compact />
          <a
            href={APP_HOME_ROUTE}
            onFocus={() => onHomeIntent?.()}
            onPointerEnter={() => onHomeIntent?.()}
            onTouchStart={() => onHomeIntent?.()}
            onMouseDown={() => onHomeIntent?.()}
            className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-full bg-white px-4 text-[12.5px] font-bold tracking-normal text-[#0b0d0e] shadow-[0_10px_26px_rgba(0,0,0,0.22)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
          >
            {t('landing.cta')}
            <IconArrowRight size={13} stroke={2.4} />
          </a>
        </div>
      </div>
    </header>
  );
}
