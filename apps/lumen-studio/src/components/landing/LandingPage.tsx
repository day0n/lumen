'use client';

import { LandingNav } from '@/components/landing/LandingNav';
import { ParticleStory } from '@/components/landing/ParticleStory';
import { useLoginRedirect } from '@/lib/auth-redirect';
import { IconArrowRight } from '@tabler/icons-react';
import Link from 'next/link';
import type { MouseEvent } from 'react';

export function LandingPage() {
  const { isLoaded, requireLogin } = useLoginRedirect();

  const handleCreate = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isLoaded) return;
    if (!requireLogin('/canvas/new?agent=chat')) event.preventDefault();
  };

  return (
    <div className="min-h-screen bg-[#0c0d0f] text-[#f4f6f8]">
      <LandingNav />
      <main>
        <ParticleStory onCreateClick={handleCreate} />

        <section className="relative z-20 bg-[#111315] px-6 py-16 text-white md:px-16 lg:px-[120px]">
          <div className="grid gap-12 lg:grid-cols-[1fr_360px] lg:items-end">
            <div>
              <p className="lumen-serif-display text-[32px] font-black leading-[1.08] tracking-normal md:text-[50px] lg:text-[64px]">
                从商品链接，
                <br />
                到脚本、镜头、
                <br />
                素材和成片。
              </p>
            </div>

            <div className="space-y-8">
              <p className="text-[15px] leading-7 tracking-normal text-white/62">
                Lumen 把短视频创作拆成可以理解、可以运行、可以复盘的工作流。它参考爆款结构，
                但最终讲的是你自己的商品。
              </p>
              <Link
                href="/canvas/new?agent=chat"
                onClick={handleCreate}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#79e4ff] px-5 text-[14px] font-bold tracking-normal text-[#071316]"
              >
                进入工作室
                <IconArrowRight size={16} stroke={2.4} />
              </Link>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
