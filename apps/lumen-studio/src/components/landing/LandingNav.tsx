'use client';

import { LumenMark } from '@/components/ui/LumenMark';
import Link from 'next/link';

export function LandingNav() {
  return (
    <header className="pointer-events-none fixed inset-x-0 top-0 z-50">
      <div className="pointer-events-auto mx-auto flex h-[72px] max-w-[1240px] items-center gap-5 px-5 md:h-[82px] md:px-7">
        <Link href="/" className="flex items-center gap-3" aria-label="Lumen 首页">
          <LumenMark size={26} />
          <span className="font-display text-[18px] font-extrabold tracking-normal text-white">
            Lumen
          </span>
        </Link>
      </div>
    </header>
  );
}
