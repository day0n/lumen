'use client';

import { LandingNav } from '@/components/landing/LandingNav';
import { ParticleStory } from '@/components/landing/ParticleStory';
import { useHomeRoutePreload } from '@/components/landing/useHomeRoutePreload';
import { LumenWordmark } from '@/components/ui/LumenWordmark';
import { IconArrowRight } from '@tabler/icons-react';
import Link from 'next/link';

const footerGroups = [
  {
    title: 'Product',
    links: [
      { href: '/home', label: '工作室' },
      { href: '/canvas/projects', label: '项目画布' },
      { href: '/hot-videos', label: '爆款素材' },
    ],
  },
  {
    title: 'Workflow',
    links: [
      { href: '/canvas/projects', label: '脚本生成' },
      { href: '/canvas/projects', label: '镜头拆解' },
      { href: '/canvas/projects', label: '素材复盘' },
    ],
  },
] as const;

export function LandingPage() {
  const warmHomeRoute = useHomeRoutePreload();

  return (
    <div className="min-h-screen bg-[#0c0d0f] text-[#f4f6f8]">
      <LandingNav onHomeIntent={warmHomeRoute} />
      <main>
        <ParticleStory onHomeIntent={warmHomeRoute} />

        <section className="relative z-20 overflow-hidden rounded-b-[34px] bg-[#f4f1e8] px-6 py-16 text-[#101214] shadow-[0_28px_80px_rgba(0,0,0,0.34)] md:px-16 md:py-20 lg:px-[120px]">
          <div
            aria-hidden
            className="pointer-events-none absolute inset-0 opacity-[0.18]"
            style={{
              backgroundImage:
                'linear-gradient(90deg, rgba(16,18,20,0.12) 1px, transparent 1px), linear-gradient(180deg, rgba(16,18,20,0.1) 1px, transparent 1px)',
              backgroundSize: '88px 88px',
            }}
          />
          <div className="relative grid gap-12 lg:grid-cols-[1fr_390px] lg:items-end">
            <div>
              <p className="mb-6 text-[12px] font-bold uppercase tracking-normal text-[#79806f]">
                Lumen Studio
              </p>
              <p className="lumen-serif-display text-[34px] font-black leading-[1.08] tracking-normal md:text-[52px] lg:text-[66px]">
                从商品链接，
                <br />
                到脚本、镜头、
                <br />
                素材和成片。
              </p>
            </div>

            <div className="space-y-8">
              <p className="text-[15px] leading-7 tracking-normal text-[#343735]/[0.72]">
                Lumen 把短视频创作拆成可以理解、可以运行、可以复盘的工作流。它参考爆款结构，
                但最终讲的是你自己的商品。
              </p>
              <div className="grid grid-cols-3 gap-3 text-[12px] font-bold tracking-normal text-[#101214]/[0.74]">
                <span className="border-t border-[#101214]/[0.16] pt-3">商品理解</span>
                <span className="border-t border-[#101214]/[0.16] pt-3">爆款结构</span>
                <span className="border-t border-[#101214]/[0.16] pt-3">成片复盘</span>
              </div>
              <Link
                href="/home"
                prefetch
                onFocus={() => warmHomeRoute()}
                onPointerEnter={() => warmHomeRoute()}
                onTouchStart={() => warmHomeRoute()}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#101214] px-6 text-[14px] font-bold tracking-normal text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                开始创造
                <IconArrowRight size={16} stroke={2.4} />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 bg-[#070808] px-6 pb-10 pt-20 text-white md:px-16 lg:px-[120px]">
        <div className="grid gap-14 lg:grid-cols-[1fr_420px]">
          <div className="max-w-[520px]">
            <LumenWordmark markSize={30} wordClassName="text-[42px]" />
            <p className="mt-7 max-w-[420px] text-[14px] leading-7 tracking-normal text-white/[0.54]">
              把一次灵感、一次判断、一次复盘，都变成下一条带货视频能复用的工作流。
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10">
            {footerGroups.map((group) => (
              <div key={group.title}>
                <p className="mb-5 text-[12px] font-bold uppercase tracking-normal text-[#8b806f]">
                  {group.title}
                </p>
                <div className="space-y-3">
                  {group.links.map((item) => (
                    <Link
                      key={`${group.title}-${item.label}`}
                      href={item.href}
                      prefetch={item.href === '/home' ? true : undefined}
                      onFocus={() => {
                        if (item.href === '/home') warmHomeRoute();
                      }}
                      onPointerEnter={() => {
                        if (item.href === '/home') warmHomeRoute();
                      }}
                      onTouchStart={() => {
                        if (item.href === '/home') warmHomeRoute();
                      }}
                      className="block text-[14px] font-medium tracking-normal text-white/[0.64] transition-colors hover:text-white"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-5 border-t border-white/[0.08] pt-7 text-[12px] tracking-normal text-white/[0.38] sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Lumen</p>
          <Link
            href="/home"
            prefetch
            onFocus={() => warmHomeRoute()}
            onPointerEnter={() => warmHomeRoute()}
            onTouchStart={() => warmHomeRoute()}
            className="inline-flex h-10 w-fit items-center justify-center gap-2 self-end rounded-full border border-white/[0.12] px-4 text-[13px] font-bold tracking-normal text-white transition-colors hover:border-white/[0.28] hover:bg-white/[0.06] sm:self-auto"
          >
            开始创造
            <IconArrowRight size={15} stroke={2.4} />
          </Link>
        </div>
      </footer>
    </div>
  );
}
