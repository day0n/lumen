'use client';

import { type MouseEvent, useCallback, useEffect, useState } from 'react';
import Link from '../../compat/next-link';
import { useI18n } from '../../i18n/provider';
import { useLoginRedirect } from '../../lib/auth-redirect';
import { cn } from '../../lib/cn';
import { isLoginRequiredPath } from '../../lib/protected-paths';
import { resolveReleaseAssetUrl } from '../../lib/release-asset-url';
import { ArrowUpRightIcon, ChevronLeftIcon, ChevronRightIcon } from './home-icons';

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

// 文案走「任务驱动」：说清用户能用它做成什么，而不是「某功能上线」。
// href 深链到对应任务的真实入口，点一下就进到能直接干活的地方。
const FEATURED_POSTERS: Slide[] = [
  {
    id: 'agent-mode-pop',
    title: 'Describe a product, get a shoppable video',
    href: '/canvas/new?agent=chat',
    coverUrl: homePosterUrl('agent-pop.webp'),
    accent: '#ff4aa2',
  },
  {
    id: 'material-mythic',
    title: 'Turn library assets into a finished cut',
    href: '/materials',
    coverUrl: homePosterUrl('material-mythic.webp'),
    accent: '#f1d1a4',
  },
  {
    id: 'hot-remix-collage',
    title: 'Remix a viral video in one click',
    href: '/hot-videos',
    coverUrl: homePosterUrl('hot-remix-collage.webp'),
    accent: '#f36b5f',
  },
  {
    id: 'agent-chat-minimal',
    title: 'Paste a link, let the agent build the cut',
    href: '/canvas/new?agent=chat',
    coverUrl: homePosterUrl('agent-chat-minimal.webp'),
    accent: '#c7e8ff',
  },
  {
    id: 'material-archive',
    title: 'Tons of assets, instant shoppable cuts',
    href: '/materials',
    coverUrl: homePosterUrl('material-archive.webp'),
    accent: '#63e5cb',
  },
  {
    id: 'agent-glass',
    title: 'Describe once, generate the whole video',
    href: '/canvas/new?agent=chat',
    coverUrl: homePosterUrl('agent-glass.webp'),
    accent: '#a5f6ff',
  },
];

const ZH_FALLBACK_TITLES: Record<string, string> = {
  'agent-mode-pop': '描述一个商品，生成带货视频',
  'material-mythic': '把素材库的图做成成片',
  'hot-remix-collage': '一键复刻这条爆款',
  'agent-chat-minimal': '贴个链接，Agent 帮你出片',
  'material-archive': '海量素材，随手成片',
  'agent-glass': '描述一次，生成整条视频',
};

function homePosterUrl(filename: string) {
  return resolveReleaseAssetUrl(`${import.meta.env.BASE_URL}home-posters/selected/${filename}`);
}

function localizeFallbackSlides(locale: 'en' | 'zh'): Slide[] {
  if (locale === 'en') return FEATURED_POSTERS;
  return FEATURED_POSTERS.map((slide) => ({
    ...slide,
    title: ZH_FALLBACK_TITLES[slide.id] ?? slide.title,
  }));
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  return reducedMotion;
}

export function FeaturedCarousel() {
  const { locale, localePath, t } = useI18n();
  const { isLoaded: authLoaded, requireLogin } = useLoginRedirect();
  const [remoteSlides, setRemoteSlides] = useState<Slide[]>([]);
  const [current, setCurrent] = useState(0);
  const [paused, setPaused] = useState(false);
  const [viewportWidth, setViewportWidth] = useState(1280);
  const reducedMotion = usePrefersReducedMotion();

  useEffect(() => {
    const controller = new AbortController();

    async function loadFeatured() {
      try {
        const response = await fetch('/api/home/featured', {
          signal: controller.signal,
          headers: { 'x-lumen-locale': locale },
        });
        const payload = (await response.json()) as HomeFeaturedApiResponse;
        if (!response.ok || !payload.ok) return;

        const slides = payload.data.items
          .filter((item) => item.coverUrl && item.ctaHref)
          .map((item) => ({
            id: item.id,
            title: item.title,
            href: item.ctaHref ?? '/',
            coverUrl: resolveReleaseAssetUrl(item.coverUrl ?? ''),
            accent: item.accentColor ?? '#79e4ff',
          }));
        setRemoteSlides(slides);
      } catch {
        if (!controller.signal.aborted) setRemoteSlides([]);
      }
    }

    void loadFeatured();
    return () => controller.abort();
  }, [locale]);

  const slides = remoteSlides.length > 0 ? remoteSlides : localizeFallbackSlides(locale);
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
    if (paused || reducedMotion) return;
    const timer = setInterval(next, 5600);
    return () => clearInterval(timer);
  }, [next, paused, reducedMotion]);

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
              href={localePath(slide.href)}
              reducedMotion={reducedMotion}
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
          aria-label={t('home.featuredPrev')}
          onClick={prev}
          className="absolute left-4 top-1/2 z-30 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-xl bg-[#202225]/86 text-white/70 ring-1 ring-white/[0.08] backdrop-blur transition-colors hover:bg-[#2a2d30] hover:text-white md:left-8"
        >
          <ChevronLeftIcon size={20} stroke={2.2} />
        </button>
        <button
          type="button"
          aria-label={t('home.featuredNext')}
          onClick={next}
          className="absolute right-4 top-1/2 z-30 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-xl bg-[#202225]/86 text-white/70 ring-1 ring-white/[0.08] backdrop-blur transition-colors hover:bg-[#2a2d30] hover:text-white md:right-8"
        >
          <ChevronRightIcon size={20} stroke={2.2} />
        </button>
      </div>

      <div className="-mt-5 flex items-center justify-center gap-2">
        {slides.map((slide, index) => (
          <button
            key={slide.id}
            type="button"
            aria-label={t('home.featuredGoTo', { title: slide.title })}
            onClick={() => setCurrent(index)}
            className="group flex min-h-11 min-w-11 items-center justify-center rounded-full"
          >
            <span
              className={cn(
                'h-1.5 rounded-full transition-all',
                index === safeCurrent
                  ? 'w-9 bg-white/70'
                  : 'w-4 bg-white/18 group-hover:bg-white/35',
              )}
            />
          </button>
        ))}
      </div>
    </section>
  );
}

function PosterSlide({
  slide,
  diff,
  href,
  onClick,
  reducedMotion,
  sideOffset,
  slideHeight,
  slideWidth,
}: {
  slide: Slide;
  diff: number;
  href: string;
  onClick: (event: MouseEvent<HTMLAnchorElement>, href: string) => void;
  reducedMotion: boolean;
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
  const z = isCenter ? 0 : -125;

  return (
    <Link
      href={href}
      aria-label={slide.title}
      onClick={(event) => onClick(event, href)}
      prefetch={false}
      className="absolute left-1/2 top-1/2 block overflow-hidden rounded-[22px] bg-[#111315] text-left ring-1 ring-white/[0.09]"
      style={{
        boxShadow: isCenter ? '0 28px 86px -56px rgba(255,255,255,0.34)' : undefined,
        height: slideHeight,
        filter: isCenter ? 'brightness(1)' : 'brightness(0.46) saturate(0.86)',
        opacity,
        transformOrigin: diff < 0 ? 'right center' : 'left center',
        transformStyle: 'preserve-3d',
        transform: `translateX(${x}px) translateY(${y}px) translateZ(${z}px) scale(${scale}) rotateY(${rotateY}deg)`,
        transitionDuration: reducedMotion ? '0ms' : '720ms',
        transitionProperty: 'filter, opacity, transform',
        transitionTimingFunction: 'cubic-bezier(0.32, 0.72, 0, 1)',
        width: slideWidth,
        zIndex: isCenter ? 10 : 4,
      }}
    >
      {Math.abs(diff) <= 1 ? (
        <img
          alt={slide.title}
          className="h-full w-full object-cover"
          decoding="async"
          draggable={false}
          fetchPriority={isCenter ? 'high' : 'low'}
          loading={isCenter ? 'eager' : 'lazy'}
          src={slide.coverUrl}
        />
      ) : null}
      <span className="pointer-events-none absolute inset-0 rounded-[22px] ring-1 ring-inset ring-white/[0.08]" />
      <span className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(255,255,255,0.05)_0%,transparent_28%,rgba(0,0,0,0.1)_100%)] opacity-70" />
      <span className="pointer-events-none absolute inset-x-0 bottom-0 h-28 bg-[linear-gradient(180deg,transparent_0%,rgba(9,10,11,0.58)_64%,rgba(9,10,11,0.92)_100%)]" />
      {isCenter ? (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 z-[2] flex items-end justify-between gap-3 p-4 md:p-5">
          <span className="min-w-0 flex-1 text-[15px] font-black leading-tight text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.6)] md:text-[19px]">
            {slide.title}
          </span>
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-[#111315] shadow-[0_8px_22px_-10px_rgba(0,0,0,0.7)]">
            <ArrowUpRightIcon size={18} stroke={2.6} />
          </span>
        </div>
      ) : null}
    </Link>
  );
}
