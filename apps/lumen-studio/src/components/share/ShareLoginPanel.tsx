'use client';

import { LumenMark } from '@/components/ui/LumenMark';
import { useI18n } from '@/i18n/provider';
import { SignIn, useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

export function ShareLoginPanel({
  projectTitle,
  shareId,
}: { projectTitle: string; shareId: string }) {
  const router = useRouter();
  const { isLoaded, isSignedIn } = useAuth();
  const { t, localePath } = useI18n();
  const sharePath = localePath(`/share/${shareId}`);

  useEffect(() => {
    if (isLoaded && isSignedIn) router.refresh();
  }, [isLoaded, isSignedIn, router]);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#050607] px-6 py-12 text-white">
      <div className="absolute inset-0 opacity-70 blur-[2px]">
        <div className="absolute left-[10%] top-[18%] h-[320px] w-[520px] rounded-[32px] border border-white/[0.12] bg-[#16191d]/80 shadow-[0_40px_140px_rgba(0,0,0,0.55)]" />
        <div className="absolute left-[24%] top-[28%] h-[150px] w-[270px] rounded-[16px] border border-white/[0.13] bg-[#202328]" />
        <div className="absolute left-[43%] top-[31%] h-[130px] w-[240px] rounded-[16px] border border-[#79e4ff]/28 bg-[#121821]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_34%,rgba(121,228,255,0.16),transparent_34%),radial-gradient(circle_at_74%_20%,rgba(214,255,156,0.1),transparent_26%)]" />
      </div>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-md" />

      <div className="relative z-10 flex w-full max-w-[440px] flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <LumenMark size={42} />
          <div>
            <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-white/38">
              {t('share.label')}
            </p>
            <h1 className="mt-2 max-w-[360px] truncate font-display text-[22px] font-black text-white">
              {projectTitle}
            </h1>
          </div>
        </div>
        <div className="rounded-[24px] bg-[#111315]/72 p-2 shadow-[0_28px_90px_rgba(0,0,0,0.5)] ring-1 ring-white/[0.1] backdrop-blur-2xl">
          <SignIn fallbackRedirectUrl={sharePath} forceRedirectUrl={sharePath} routing="hash" />
        </div>
      </div>
    </main>
  );
}
