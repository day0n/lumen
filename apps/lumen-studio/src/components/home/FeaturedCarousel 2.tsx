'use client';

import { motion, AnimatePresence } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/cn';

interface Slide {
  id: string;
  tag: string;
  category: string;
  title: string;
  description: string;
  stats: string;
  gradient: string;
  emoji: string;
  // 强调色，用于 Pill 与按钮微调
  accent: string;
}

const SLIDES: Slide[] = [
  {
    id: 'asmr',
    tag: '⭐ 官方',
    category: '食品 · ASMR',
    title: '食欲大爆炸 ASMR',
    description: '高密度特写镜头与沉浸式音效，让屏幕前的人秒咽口水。适合食品、零食、餐饮类商品。',
    stats: '▶ 42k 使用 · ★ 4.9',
    gradient:
      'linear-gradient(135deg, #ff7a4a 0%, #ffb02a 40%, #4ade80 100%)',
    emoji: '🍱',
    accent: '#ffb02a',
  },
  {
    id: 'ritual',
    tag: '⭐ 本周精选',
    category: '美妆 · 第一人称沉浸',
    title: '夏日清凉护肤仪式',
    description:
      '基于 12 条美妆类百万爆款沉淀的"第一人称"叙事框架。整片 12-15s，自带优雅知性女声配音，适合护肤、清洁、美妆类商品。',
    stats: '▶ 28.4k 使用 · ★ 4.8',
    gradient:
      'linear-gradient(135deg, #ff4d2e 0%, #ff7a4a 35%, #b48fff 100%)',
    emoji: '🌊',
    accent: '#ff7a4a',
  },
  {
    id: 'neon',
    tag: '🆕 新模板',
    category: '数码 · 暗黑美学',
    title: '夜店霓虹风',
    description: '赛博朋克美学加强节奏剪辑，适合潮玩、电子产品、潮牌服饰。',
    stats: '▶ 9.4k 使用 · ★ 4.7',
    gradient:
      'linear-gradient(135deg, #1a1611 0%, #2a4cff 50%, #b48fff 100%)',
    emoji: '✨',
    accent: '#b48fff',
  },
  {
    id: 'clone',
    tag: '🔥 热门',
    category: '通用 · 仿写爆款',
    title: 'TikTok 爆款克隆术',
    description: 'AI 自动匹配你商品类目下的最佳爆款，1:1 还原叙事节奏与镜头语言。',
    stats: '▶ 15.8k 使用 · ★ 4.6',
    gradient:
      'linear-gradient(135deg, #b48fff 0%, #ff4d2e 60%, #ffb02a 100%)',
    emoji: '🔥',
    accent: '#ff4d2e',
  },
  {
    id: 'compare',
    tag: '⭐ 官方',
    category: '美妆 · 对比效果',
    title: '前后对比震撼',
    description: '使用前 / 使用后对比剪辑，效果类商品的杀手锏。适合美妆、护肤、清洁。',
    stats: '▶ 28.1k 使用 · ★ 4.8',
    gradient:
      'linear-gradient(135deg, #4ade80 0%, #ffb02a 50%, #ff4d2e 100%)',
    emoji: '💫',
    accent: '#4ade80',
  },
];

export function FeaturedCarousel() {
  const [current, setCurrent] = useState(1);
  const [paused, setPaused] = useState(false);

  const next = useCallback(() => {
    setCurrent((c) => (c + 1) % SLIDES.length);
  }, []);
  const prev = useCallback(() => {
    setCurrent((c) => (c - 1 + SLIDES.length) % SLIDES.length);
  }, []);

  useEffect(() => {
    if (paused) return;
    const t = setInterval(next, 6000);
    return () => clearInterval(t);
  }, [paused, next]);

  return (
    <section
      className="relative mt-6"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <SectionHeader
        title="官方精选模板"
        sub="基于平台数据沉淀的爆款套路 · 点击即用"
        action="查看全部"
      />

      <div
        className="relative mx-auto h-[440px] w-full"
        style={{ perspective: '2000px' }}
      >
        {/* 左右两侧暗化渐变蒙版，强化中心舞台感 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-0 z-30 w-[16%]"
          style={{
            background:
              'linear-gradient(to right, rgba(7,5,3,0.95) 0%, rgba(7,5,3,0.4) 60%, transparent)',
          }}
        />
        <div
          aria-hidden
          className="pointer-events-none absolute inset-y-0 right-0 z-30 w-[16%]"
          style={{
            background:
              'linear-gradient(to left, rgba(7,5,3,0.95) 0%, rgba(7,5,3,0.4) 60%, transparent)',
          }}
        />

        <div className="relative h-full" style={{ transformStyle: 'preserve-3d' }}>
          {SLIDES.map((slide, idx) => {
            const total = SLIDES.length;
            let diff = idx - current;
            if (diff > total / 2) diff -= total;
            if (diff < -total / 2) diff += total;

            return <CarouselSlide key={slide.id} slide={slide} diff={diff} onClick={() => setCurrent(idx)} />;
          })}
        </div>

        {/* 左右箭头 */}
        <ArrowButton direction="prev" onClick={prev} />
        <ArrowButton direction="next" onClick={next} />
      </div>

      {/* dots */}
      <div className="mt-6 flex items-center justify-center gap-1.5">
        {SLIDES.map((s, i) => (
          <button
            key={s.id}
            type="button"
            onClick={() => setCurrent(i)}
            className="group relative h-1.5 overflow-hidden rounded-full transition-all"
            style={{ width: i === current ? 44 : 14 }}
          >
            <span
              aria-hidden
              className={cn(
                'absolute inset-0 rounded-full transition-colors',
                i === current ? 'bg-flame-500' : 'bg-white/15 group-hover:bg-white/30',
              )}
            />
            {i === current && !paused && (
              <motion.span
                aria-hidden
                className="absolute inset-y-0 left-0 rounded-full bg-white/60"
                initial={{ width: 0 }}
                animate={{ width: '100%' }}
                transition={{ duration: 6, ease: 'linear' }}
                key={current}
              />
            )}
          </button>
        ))}
      </div>
    </section>
  );
}

function CarouselSlide({
  slide,
  diff,
  onClick,
}: {
  slide: Slide;
  diff: number;
  onClick: () => void;
}) {
  const isCenter = diff === 0;
  const isAdjacent = Math.abs(diff) === 1;

  let translateX = 0;
  let translateZ = 0;
  let rotateY = 0;
  let opacity = 0;
  let zIndex = 0;
  let scale = 1;

  if (diff === 0) {
    translateZ = 80;
    zIndex = 20;
    opacity = 1;
    scale = 1;
  } else if (diff === -1) {
    translateX = -560;
    translateZ = -80;
    rotateY = 32;
    zIndex = 10;
    opacity = 0.7;
    scale = 0.92;
  } else if (diff === 1) {
    translateX = 560;
    translateZ = -80;
    rotateY = -32;
    zIndex = 10;
    opacity = 0.7;
    scale = 0.92;
  } else if (diff < -1) {
    translateX = -900;
    translateZ = -300;
    rotateY = 40;
    opacity = 0;
  } else {
    translateX = 900;
    translateZ = -300;
    rotateY = -40;
    opacity = 0;
  }

  return (
    <motion.div
      onClick={onClick}
      className="absolute left-1/2 top-1/2 cursor-pointer"
      style={{
        zIndex,
        width: 880,
        height: 380,
        marginLeft: -440,
        marginTop: -190,
        transformStyle: 'preserve-3d',
        transformOrigin: 'center center',
      }}
      animate={{
        x: translateX,
        z: translateZ,
        rotateY,
        opacity,
        scale,
      }}
      transition={{
        duration: 0.85,
        ease: [0.32, 0.72, 0, 1],
      }}
    >
      <div
        className="relative h-full w-full overflow-hidden rounded-[28px]"
        style={{
          background: slide.gradient,
          boxShadow: isCenter
            ? `0 40px 80px -20px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.06), 0 0 60px -10px ${slide.accent}55`
            : '0 24px 48px -12px rgba(0,0,0,0.5)',
        }}
      >
        {/* 顶层高光弧 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-1/2"
          style={{
            background:
              'linear-gradient(to bottom, rgba(255,255,255,0.18), transparent 80%)',
            mixBlendMode: 'overlay',
          }}
        />

        {/* emoji 装饰 */}
        <div
          className="pointer-events-none absolute right-[-30px] bottom-[-50px] text-[320px] leading-none opacity-15 select-none"
          aria-hidden
        >
          {slide.emoji}
        </div>

        {/* 颗粒纹理 */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-25 mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />

        {/* 底部内容 */}
        <div className="absolute inset-x-0 bottom-0 z-10 p-9 text-white">
          <div className="inline-flex items-center gap-2 rounded-full border border-white/30 bg-black/25 px-3 py-1 text-[11px] font-semibold backdrop-blur-md">
            {slide.tag}
          </div>
          <div className="mt-5 text-[12px] uppercase tracking-[0.18em] text-white/80">
            {slide.category}
          </div>
          <h3 className="font-display mt-2 text-[42px] font-extrabold leading-[1.05] tracking-tight">
            {slide.title}
          </h3>

          <AnimatePresence>
            {isCenter && (
              <motion.div
                key="center-extra"
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                transition={{ duration: 0.4, delay: 0.1 }}
              >
                <p className="mt-3 max-w-[520px] text-[13px] leading-[1.6] text-white/85">
                  {slide.description}
                </p>
                <div className="mt-5 flex items-center gap-3">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 rounded-full bg-white px-5 py-2.5 text-[13px] font-semibold text-black shadow-[0_8px_24px_-4px_rgba(0,0,0,0.5)] transition-transform hover:scale-[1.03] active:scale-[0.98]"
                  >
                    立即使用
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <line x1="5" y1="12" x2="19" y2="12" />
                      <polyline points="12 5 19 12 12 19" />
                    </svg>
                  </button>
                  <span className="text-[12px] text-white/70">{slide.stats}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* 中央点击播放按钮（仅 center） */}
        {isCenter && (
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="absolute right-9 top-9 z-10 flex h-12 w-12 items-center justify-center rounded-full bg-white/95 text-black backdrop-blur"
            style={{ boxShadow: '0 8px 20px -4px rgba(0,0,0,0.5)' }}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function ArrowButton({
  direction,
  onClick,
}: {
  direction: 'prev' | 'next';
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={direction === 'prev' ? '上一个' : '下一个'}
      className={cn(
        'glass glass-edge absolute top-1/2 z-40 flex h-12 w-12 -translate-y-1/2 items-center justify-center rounded-full text-white transition-all hover:bg-white/15 active:scale-90',
        direction === 'prev' ? 'left-8' : 'right-8',
      )}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transform: direction === 'prev' ? 'rotate(180deg)' : undefined }}
      >
        <polyline points="9 18 15 12 9 6" />
      </svg>
    </button>
  );
}

function SectionHeader({
  title,
  sub,
  action,
}: {
  title: string;
  sub?: string;
  action?: string;
}) {
  return (
    <div className="mx-auto mb-7 flex max-w-[1280px] items-end gap-4 px-10">
      <div>
        <h2 className="font-display text-[22px] font-bold tracking-tight text-white">{title}</h2>
        {sub && <p className="mt-1 text-[12.5px] text-white/45">{sub}</p>}
      </div>
      {action && (
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-white/55 transition-colors hover:text-white"
        >
          {action}
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      )}
    </div>
  );
}
