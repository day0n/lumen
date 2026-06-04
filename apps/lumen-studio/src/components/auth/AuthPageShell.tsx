import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { LumenMark } from '@/components/ui/LumenMark';
import { type Locale, localePath } from '@/i18n/routing';
import type { ReactNode } from 'react';

export function AuthPageShell({
  children,
  locale,
}: {
  children: ReactNode;
  locale: Locale;
}) {
  return (
    <main className="relative flex min-h-dvh items-center justify-center px-4 pb-[max(16px,env(safe-area-inset-bottom))] pt-[max(16px,env(safe-area-inset-top))] text-white sm:px-6 sm:py-12">
      <AuroraBackdrop />
      <div className="relative z-10 flex w-full max-w-[440px] flex-col items-center gap-6 sm:gap-8">
        <a href={localePath('/', locale)} className="flex min-h-11 items-center gap-3">
          <LumenMark size={32} />
          <span className="font-display text-[17px] font-bold tracking-tight text-white sm:text-[18px]">
            Lumen
          </span>
        </a>
        <div className="w-full min-w-0 [&_.cl-card]:w-full [&_.cl-cardBox]:w-full [&_.cl-rootBox]:w-full">
          {children}
        </div>
      </div>
    </main>
  );
}
