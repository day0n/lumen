'use client';

import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { FeaturedCarousel } from '@/components/home/FeaturedCarousel';
import { Hero } from '@/components/home/Hero';
import { HomeParticleStory } from '@/components/home/HomeParticleStory';
import { TemplateRail } from '@/components/home/TemplateRail';
import { Topbar } from '@/components/home/Topbar';

export default function StudioHomePage() {
  return (
    <div className="relative">
      <AuroraBackdrop />
      <Topbar />

      <main className="relative z-10 pt-28">
        <FeaturedCarousel />
        <Hero />
        <HomeParticleStory />
        <TemplateRail />
        <div className="h-24" />
      </main>
    </div>
  );
}
