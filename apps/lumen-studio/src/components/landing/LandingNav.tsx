'use client';

import { LumenWordmark } from '@/components/ui/LumenWordmark';
import { useLoginRedirect } from '@/lib/auth-redirect';
import { IconArrowRight } from '@tabler/icons-react';
import Link from 'next/link';
import type { MouseEvent } from 'react';

const navLinks = [
  { href: '/home', label: '工作室' },
  { href: '/hot-videos', label: '爆款素材' },
  { href: '/canvas/projects', label: '项目画布' },
] as const;

export function LandingNav() {
  const { isLoaded, requireLogin } = useLoginRedirect();

  const handleOpenWorkspace = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isLoaded) {
      event.preventDefault();
      return;
    }
    if (!requireLogin('/canvas/projects')) event.preventDefault();
  };

  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50 border-b border-white/[0.08] bg-[#050607]/[0.88] backdrop-blur-2xl">
      <div className="pointer-events-auto mx-auto flex h-[74px] max-w-[1260px] items-center justify-between gap-4 px-5 md:px-8">
        <Link href="/" aria-label="Lumen 首页">
          <LumenWordmark markSize={26} wordClassName="text-[30px]" />
        </Link>

        <nav className="hidden items-center gap-7 lg:flex" aria-label="Lumen 导航">
          {navLinks.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="text-[14px] font-medium tracking-normal text-white/[0.58] transition-colors hover:text-white"
            >
              {item.label}
            </Link>
          ))}
        </nav>

        <Link
          href="/canvas/projects"
          onClick={handleOpenWorkspace}
          className="inline-flex h-11 items-center justify-center gap-2 rounded-full bg-white px-5 text-[14px] font-bold tracking-normal text-[#0b0d0e] shadow-[0_14px_34px_rgba(0,0,0,0.22)] transition-transform hover:scale-[1.02] active:scale-[0.98]"
        >
          开始创造
          <IconArrowRight size={15} stroke={2.4} />
        </Link>
      </div>
    </header>
  );
}
