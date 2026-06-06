'use client';

import { LandingNav } from '@/components/landing/LandingNav';
import { ParticleStory } from '@/components/landing/ParticleStory';
import {
  APP_HOME_ROUTE,
  APP_HOT_VIDEOS_ROUTE,
  APP_PROJECTS_ROUTE,
  useHomeRoutePreload,
} from '@/components/landing/useHomeRoutePreload';
import { LumenWordmark } from '@/components/ui/LumenWordmark';
import { useI18n } from '@/i18n/provider';
import { IconArrowRight } from '@tabler/icons-react';

const footerGroups = [
  {
    titleKey: 'landing.footerGroups.product',
    links: [
      { href: APP_HOME_ROUTE, labelKey: 'landing.footerGroups.studio' },
      { href: APP_PROJECTS_ROUTE, labelKey: 'landing.footerGroups.canvas' },
      { href: APP_HOT_VIDEOS_ROUTE, labelKey: 'landing.footerGroups.hotAssets' },
    ],
  },
  {
    titleKey: 'landing.footerGroups.workflow',
    links: [
      { href: APP_PROJECTS_ROUTE, labelKey: 'landing.footerGroups.script' },
      { href: APP_PROJECTS_ROUTE, labelKey: 'landing.footerGroups.shots' },
      { href: APP_PROJECTS_ROUTE, labelKey: 'landing.footerGroups.review' },
    ],
  },
] as const;

export function LandingPage() {
  const warmHomeRoute = useHomeRoutePreload();
  const { t, ta } = useI18n();
  const pillars = ta('landing.pillars');

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
                {t('landing.sectionTitle')}
              </p>
            </div>

            <div className="space-y-8">
              <p className="text-[15px] leading-7 tracking-normal text-[#343735]/[0.72]">
                {t('landing.description')}
              </p>
              <div className="grid grid-cols-3 gap-3 text-[12px] font-bold tracking-normal text-[#101214]/[0.74]">
                {pillars.map((pillar) => (
                  <span key={pillar} className="border-t border-[#101214]/[0.16] pt-3">
                    {pillar}
                  </span>
                ))}
              </div>
              <a
                href={APP_HOME_ROUTE}
                onFocus={() => warmHomeRoute()}
                onPointerEnter={() => warmHomeRoute()}
                onTouchStart={() => warmHomeRoute()}
                onMouseDown={() => warmHomeRoute()}
                className="inline-flex h-12 items-center justify-center gap-2 rounded-full bg-[#101214] px-6 text-[14px] font-bold tracking-normal text-white transition-transform hover:scale-[1.02] active:scale-[0.98]"
              >
                {t('landing.cta')}
                <IconArrowRight size={16} stroke={2.4} />
              </a>
            </div>
          </div>
        </section>
      </main>

      <footer className="relative z-10 bg-[#070808] px-6 pb-10 pt-20 text-white md:px-16 lg:px-[120px]">
        <div className="grid gap-14 lg:grid-cols-[1fr_420px]">
          <div className="max-w-[520px]">
            <LumenWordmark markSize={30} wordClassName="text-[42px]" />
            <p className="mt-7 max-w-[420px] text-[14px] leading-7 tracking-normal text-white/[0.54]">
              {t('landing.footerCopy')}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-10">
            {footerGroups.map((group) => (
              <div key={group.titleKey}>
                <p className="mb-5 text-[12px] font-bold uppercase tracking-normal text-[#8b806f]">
                  {t(group.titleKey)}
                </p>
                <div className="space-y-3">
                  {group.links.map((item) => (
                    <a
                      key={`${group.titleKey}-${item.labelKey}`}
                      href={item.href}
                      onFocus={() => warmHomeRoute()}
                      onPointerEnter={() => warmHomeRoute()}
                      onTouchStart={() => warmHomeRoute()}
                      className="block text-[14px] font-medium tracking-normal text-white/[0.64] transition-colors hover:text-white"
                    >
                      {t(item.labelKey)}
                    </a>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="mt-16 flex flex-col gap-5 border-t border-white/[0.08] pt-7 text-[12px] tracking-normal text-white/[0.38] sm:flex-row sm:items-center sm:justify-between">
          <p>© 2026 Lumen</p>
          <a
            href={APP_HOME_ROUTE}
            onFocus={() => warmHomeRoute()}
            onPointerEnter={() => warmHomeRoute()}
            onTouchStart={() => warmHomeRoute()}
            onMouseDown={() => warmHomeRoute()}
            className="inline-flex h-10 w-fit items-center justify-center gap-2 self-end rounded-full border border-white/[0.12] px-4 text-[13px] font-bold tracking-normal text-white transition-colors hover:border-white/[0.28] hover:bg-white/[0.06] sm:self-auto"
          >
            {t('landing.cta')}
            <IconArrowRight size={15} stroke={2.4} />
          </a>
        </div>
      </footer>
    </div>
  );
}
