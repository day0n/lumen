'use client';

import { useLoginRedirect } from '@/lib/auth-redirect';
import { cn } from '@/lib/cn';
import { isLoginRequiredPath } from '@/lib/protected-paths';
import { IconChevronLeft, IconChevronRight } from '@tabler/icons-react';
import { motion } from 'motion/react';
import { type MouseEvent, useCallback, useEffect, useMemo, useState } from 'react';

interface Slide {
  id: string;
  title: string;
  href: string;
  coverUrl: string;
  accent: string;
}

type HomeFeaturedApiResponse =
  | {
      ok: true;
      data: {
        items: Array<{
          id: string;
          title: string;
          ctaHref?: string;
          coverUrl?: string;
          accentColor?: string;
        }>;
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

const FEATURED_POSTERS: Slide[] = [
  {
    id: 'agent-mode-pop',
    title: 'Agent 模式上线',
    href: '/canvas/new?agent=chat',
    coverUrl: '/home-posters/selected/agent-pop.png',
    accent: '#ff4aa2',
  },
  {
    id: 'material-mythic',
    title: '素材库上线',
    href: '/canvas/new',
    coverUrl: '/home-posters/selected/material-mythic.png',
    accent: '#f1d1a4',
  },
  {
    id: 'hot-remix-collage',
    title: '爆款复刻上线',
    href: '/hot-videos',
    coverUrl: '/home-posters/selected/hot-remix-collage.png',
    accent: '#f36b5f',
  },
  {
    id: 'agent-chat-minimal',
    title: 'Agent Chat 上线',
    href: '/canvas/new?agent=chat',
    coverUrl: '/home-posters/selected/agent-chat-minimal.png',
    accent: '#c7e8ff',
  },
  {
    id: 'material-archive',
    title: '素材库上线',
    href: '/canvas/new',
    coverUrl: '/home-posters/selected/material-archive.png',
    accent: '#63e5cb',
  },
  {
    id: 'agent-glass',
    title: 'Agent 模式上线',
    href: '/canvas/new?agent=chat',
    coverUrl: '/home-posters/selected/agent-glass.png',
    accent: '#a5f6ff',
  },
];

export function FeaturedCarousel() {
  const { isLoaded: authLoaded, requireLogin } = useLoginRedirect();
  const [remoteSlides, setRemoteSlides] = useState<Slide[]>([]);
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(1280);

  useEffect(() => {
    const controller = new AbortController();

    async function loadFeatured() {
      try {
        const response = await fetch('/api/home/featured', { signal: controller.signal });
        const payload = (await response.json()) as HomeFeaturedApiResponse;
        if (!response.ok || !payload.ok) return;

        const slides = payload.data.items
          .filter((item) => item.coverUrl && item.ctaHref)
          .map((item) => ({
            id: item.id,
            title: item.title,
            href: item.ctaHref ?? '/',
            coverUrl: item.coverUrl ?? '',
            accent: item.accentColor ?? '#79e4ff',
          }));
        setRemoteSlides(slides);
      } catch {
        if (!controller.signal.aborted) setRemoteSlides([]);
      }
    }

    void loadFeatured();
    return () => controller.abort();
  }, []);

  const slides = remoteSlides.length > 0 ? remoteSlides : FEATURED_POSTERS;
  const safeCurrent = current % slides.length;

  const next = useCallback(() => {
    setCurrent((c) => (c + 1) % slides.length);
  }, [slides.length]);

  const prev = useCallback(() => {
    setCurrent((c) => (c - 1 + slides.length) % slides.length);
  }, [slides.length]);

  const handleSlideClick = useCallback(
    (event: MouseEvent<HTMLAnchorElement>, href: string) => {
      if (!authLoaded || !isLoginRequiredPath(href)) return;
      if (!requireLogin(href)) event.preventDefault();
    },
    [authLoaded, requireLogin],
  );

  useEffect(() => {
    if (paused) return;
    const timer = setInterval(next, 5600);
    return () => clearInterval(timer);
  }, [next, paused]);

  useEffect(() => {
    const updateViewportWidth = () => setViewportWidth(window.innerWidth);
    updateViewportWidth();
    window.addEventListener('resize', updateViewportWidth);
    return () => window.removeEventListener('resize', updateViewportWidth);
  }, []);

  const isCompact = viewportWidth < 640;
  const slideWidth = isCompact
    ? Math.max(320, viewportWidth - 44)
    : Math.min(600, Math.max(460, viewportWidth * 0.36));
  const slideHeight = Math.round(slideWidth * (isCompact ? 0.56 : 0.56));
  const sideOffset = isCompact
    ? slideWidth * 0.86
    : Math.min(520, Math.max(360, viewportWidth * 0.38));
  const stageHeight = slideHeight + (isCompact ? 48 : 60);

  return (
    <section
      className="relative left-1/2 ml-[-50vw] w-screen overflow-hidden"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div
        className="relative overflow-visible"
        style={{ height: stageHeight, perspective: 1500, perspectiveOrigin: '50% 48%' }}
      >
        <div className="pointer-events-none absolute inset-y-10 left-0 z-20 w-[18vw] bg-[linear-gradient(90deg,rgba(9,10,11,0.8)_0%,rgba(9,10,11,0.36)_48%,transparent_100%)]" />
        <div className="pointer-events-none absolute inset-y-10 right-0 z-20 w-[18vw] bg-[linear-gradient(270deg,rgba(9,10,11,0.8)_0%,rgba(9,10,11,0.36)_48%,transparent_100%)]" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 h-28 bg-[linear-gradient(180deg,transparent_0%,rgba(9,10,11,0.62)_58%,#090a0b_100%)]" />

        {slides.map((slide, index) => {
          let diff = index - safeCurrent;
          if (diff > slides.length / 2) diff -= slides.length;
          if (diff < -slides.length / 2) diff += slides.length;

          return (
            <PosterSlide
              key={slide.id}
              diff={diff}
              sideOffset={sideOffset}
              slide={slide}
              slideHeight={slideHeight}
              slideWidth={slideWidth}
              onClick={handleSlideClick}
            />
          );
        })}

        <button
          type="button"
          aria-label="上一个精选"
          onClick={prev}
          className="absolute left-4 top-1/2 z-30 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-xl bg-[#202225]/86 text-white/70 ring-1 ring-white/[0.08] backdrop-blur transition-colors hover:bg-[#2a2d30] hover:text-white md:left-8"
        >
          <IconChevronLeft size={20} stroke={2.2} />
        </button>
        <button
          type="button"
          aria-label="下一个精选"
          onClick={next}
          className="absolute right-4 top-1/2 z-30 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-xl bg-[#202225]/86 text-white/70 ring-1 ring-white/[0.08] backdrop-blur transition-colors hover:bg-[#2a2d30] hover:text-white md:right-8"
        >
          <IconChevronRight size={20} stroke={2.2} />
        </button>
      </div>

      <div className="-mt-5 flex items-center justify-center gap-2">
        {slides.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            aria-label={`切换到 ${slide.title}`}
            onClick={() => setCurrent(index)}
            className={cn(
              'h-1.5 rounded-full transition-all',
              index === safeCurrent ? 'w-9 bg-white/70' : 'w-4 bg-white/18 hover:bg-white/35',
            )}
          />
        ))}
      </div>
    </section>
  );
}

function PosterSlide({
  slide,
  diff,
  onClick,
  sideOffset,
  slideHeight,
  slideWidth,
}: {
  slide: Slide;
  diff: number;
  onClick: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  sideOffset: number;
  slideHeight: number;
  slideWidth: number;
}) {
  const isCenter = diff === 0;
  const x = -slideWidth / 2 + diff * sideOffset;
  const y = -slideHeight / 2;
  const scale = isCenter ? 1 : 0.88;
  const rotateY = isCenter ? 0 : diff < 0 ? 28 : -28;
  const opacity = Math.abs(diff) > 1 ? 0 : isCenter ? 1 : 0.58;

  return (
    <motion.a
      href={slide.href}
      aria-label={slide.title}
      onClick={(event) => onClick(event, slide.href)}
      className="absolute left-1/2 top-1/2 block overflow-hidden rounded-[22px] bg-[#111315] text-left ring-1 ring-white/[0.09]"
      style={{
        boxShadow: isCenter ? '0 28px 86px -56px rgba(255,255,255,0.34)' : undefined,
        height: slideHeight,
        transformOrigin: diff < 0 ? 'right center' : 'left center',
        transformStyle: 'preserve-3d',
        width: slideWidth,
      }}
      animate={{
        filter: isCenter ? 'brightness(1)' : 'brightness(0.46) saturate(0.86)',
        opacity,
        rotateY,
        scale,
        x,
        y,
        z: isCenter ? 0 : -125,
        zIndex: isCenter ? 10 : 4,
      }}
      transition={{ duration: 0.72, ease: [0.32, 0.72, 0, 1] }}
    >
      <img
        alt={slide.title}
        className="h-full w-full object-cover"
        draggable={false}
        src={slide.coverUrl}
      />
      <span className="pointer-events-none absolute inset-0 rounded-[22px] ring-1 ring-inset ring-white/[0.08]" />
      <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05)_0%,transparent_28%,rgba(0,0,0,0.1)_100%)] opacity-70" />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-24 bg-[linear-gradient(180deg,transparent_0%,rgba(9,10,11,0.42)_72%,rgba(9,10,11,0.82)_100%)]" />
    </motion.a>
  );
}
