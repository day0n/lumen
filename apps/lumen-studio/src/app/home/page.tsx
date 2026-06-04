'use client';

import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { FeaturedCarousel } from '@/components/home/FeaturedCarousel';
import { Hero } from '@/components/home/Hero';
import { TemplateRail } from '@/components/home/TemplateRail';
import { Topbar } from '@/components/home/Topbar';

export default function StudioHomePage() {
  return (
    <div className="relative">
      <AuroraBackdrop />
      <Topbar />

      <main className="relative z-10 pb-nav-mobile pt-24 sm:pt-28">
        <FeaturedCarousel />
        <Hero />
        <TemplateRail />
      </main>
    </div>
  );
}
