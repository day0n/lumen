'use client';

import { FeaturedCarousel } from './FeaturedCarousel';
import { Hero } from './Hero';
import { TemplateRail } from './TemplateRail';

export default function HomePage() {
  return (
    <main className="relative z-10 pb-nav-mobile pt-24 sm:pt-28">
      <FeaturedCarousel />
      <Hero />
      <TemplateRail />
    </main>
  );
}
