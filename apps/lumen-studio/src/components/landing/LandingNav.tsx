'use client';

import { LumenWordmark } from '@/components/ui/LumenWordmark';
import { cn } from '@/lib/cn';
import { IconArrowRight } from '@tabler/icons-react';
import Link from 'next/link';
import { useEffect, useState } from 'react';

export function LandingNav() {
  const [scrolled, setScrolled] = useState(false);

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
          'pointer-events-none absolute left-1/2 top-1/2 h-12 w-[360px] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/[0.18] blur-3xl transition-opacity duration-300',
          scrolled ? 'opacity-100' : 'opacity-0',
        )}
      />
      <div className="pointer-events-auto relative mx-auto flex h-[62px] max-w-[1160px] items-center justify-between gap-4 px-5 md:px-7">
        <Link href="/" aria-label="Lumen 首页">
          <LumenWordmark markSize={24} wordClassName="text-[28px]" />
        </Link>

        <Link
          href="/home"
          className="inline-flex h-10 items-center justify-center gap-2 rounded-full bg-white px-5 text-[14px] font-bold tracking-normal text-[#0b0d0e] shadow-[0_14px_34px_rgba(0,0,0,0.22)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          开始创造
          <IconArrowRight size={15} stroke={2.4} />
        </Link>
      </div>
    </header>
  );
}
