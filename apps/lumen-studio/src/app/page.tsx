'use client';

import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { FeaturedCarousel } from '@/components/home/FeaturedCarousel';
import { Hero } from '@/components/home/Hero';
import { TemplateRail } from '@/components/home/TemplateRail';
import { Topbar } from '@/components/home/Topbar';

export default function HomePage() {
  return (
    <div className="relative">
      <AuroraBackdrop />
      <Topbar />

      <main className="relative z-10 pt-28">
        {/* 1. 官方精选模板 (置顶) */}
        <FeaturedCarousel />

        {/* 2. Hero 一键成片 (次要入口) */}
        <Hero />

        {/* 3. 推荐画布 */}
        <TemplateRail />

        <div className="h-24" />
      </main>
    </div>
  );
}
