'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/cn';

interface Template {
  id: string;
  name: string;
  meta: string;
  isOfficial?: boolean;
  stats: string;
  gradient: string;
}

const TEMPLATES: Template[] = [
  {
    id: 't1',
    name: '前后对比震撼',
    meta: '美妆 · 1.2k 使用',
    isOfficial: true,
    stats: '▶ 28k',
    gradient: 'linear-gradient(135deg, #ff4d2e, #ffb02a)',
  },
  {
    id: 't2',
    name: '真人测评感',
    meta: '通用 · 890 使用',
    stats: '▶ 15k',
    gradient: 'linear-gradient(135deg, #4ade80, #2a4cff)',
  },
  {
    id: 't3',
    name: '食欲大爆炸 ASMR',
    meta: '食品 · 3.1k 使用',
    isOfficial: true,
    stats: '▶ 42k',
    gradient: 'linear-gradient(135deg, #ffb02a, #ff7a4a)',
  },
  {
    id: 't4',
    name: '穿搭三连击',
    meta: '服饰 · 645 使用',
    stats: '▶ 9k',
    gradient: 'linear-gradient(135deg, #2a4cff, #b48fff)',
  },
  {
    id: 't5',
    name: '15s 高燃剪',
    meta: '通用 · 1.4k 使用',
    stats: '▶ 6k',
    gradient: 'linear-gradient(135deg, #ff7a4a, #ff4d2e)',
  },
  {
    id: 't6',
    name: '多语种带货',
    meta: '跨境 · 1.6k 使用',
    stats: '▶ 4k',
    gradient: 'linear-gradient(135deg, #b48fff, #4ade80)',
  },
  {
    id: 't7',
    name: 'A/B 双开',
    meta: '通用 · 822 使用',
    isOfficial: true,
    stats: '▶ 3k',
    gradient: 'linear-gradient(135deg, #4ade80, #ffb02a)',
  },
  {
    id: 't8',
    name: '清新治愈风',
    meta: '母婴 · 678 使用',
    stats: '▶ 2k',
    gradient: 'linear-gradient(135deg, #2a4cff, #4ade80)',
  },
];

export function TemplateRail() {
  return (
    <section className="mt-16">
      <div className="mx-auto mb-7 flex max-w-[1280px] items-end gap-4 px-10">
        <div>
          <h2 className="font-display text-[22px] font-bold tracking-tight text-white">
            更多模板
          </h2>
          <p className="mt-1 text-[12.5px] text-white/45">社区作者贡献 · 一键 Remix</p>
        </div>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-white/55 transition-colors hover:text-white"
        >
          浏览全部
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div className="mx-auto max-w-[1280px] overflow-hidden">
        <div className="flex gap-3 px-10 pb-3 overflow-x-auto scrollbar-hide">
          {TEMPLATES.map((tpl, idx) => (
            <TemplateCard key={tpl.id} template={tpl} index={idx} />
          ))}
        </div>
      </div>
    </section>
  );
}

function TemplateCard({ template, index }: { template: Template; index: number }) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.04 * index, ease: [0.32, 0.72, 0, 1] }}
      whileHover={{ y: -4 }}
      className="group relative w-[170px] shrink-0 cursor-pointer text-left"
    >
      <div
        className="relative h-[230px] overflow-hidden rounded-2xl"
        style={{
          background: template.gradient,
          boxShadow: '0 12px 32px -8px rgba(0,0,0,0.5)',
        }}
      >
        {/* 颗粒 */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-25 mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />
        {/* 顶部高光 */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-1/2"
          style={{
            background: 'linear-gradient(to bottom, rgba(255,255,255,0.15), transparent 80%)',
            mixBlendMode: 'overlay',
          }}
        />
        {/* 底部暗化便于文字可读 */}
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-2/3"
          style={{
            background:
              'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.2) 50%, transparent 100%)',
          }}
        />

        {/* 顶部 tag */}
        <div className="absolute left-2.5 top-2.5 flex items-center gap-1.5">
          {template.isOfficial && (
            <div
              className="rounded-md px-2 py-0.5 text-[9.5px] font-bold text-white"
              style={{
                background: 'linear-gradient(135deg, #ff7a4a, #ff4d2e)',
                boxShadow: '0 2px 8px -2px rgba(255,77,46,0.6)',
              }}
            >
              ⭐ 官方
            </div>
          )}
          {!template.isOfficial && (
            <div
              className="rounded-md bg-black/55 px-2 py-0.5 text-[9.5px] font-medium text-white backdrop-blur-md"
            >
              社区
            </div>
          )}
        </div>

        {/* 右下统计 */}
        <div className="absolute right-2.5 top-2.5 rounded-md bg-black/55 px-2 py-0.5 text-[9.5px] font-medium text-white backdrop-blur-md">
          {template.stats}
        </div>

        {/* 底部信息 */}
        <div className="absolute inset-x-0 bottom-0 z-10 p-3.5">
          <div className="text-[13px] font-semibold leading-tight text-white">
            {template.name}
          </div>
          <div className="mt-1 text-[10.5px] text-white/65">{template.meta}</div>

          {/* hover 出现的 Remix 按钮 */}
          <div
            className={cn(
              'mt-3 inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-[11px] font-semibold text-black opacity-0 transition-all',
              'group-hover:opacity-100 group-hover:translate-y-0 -translate-y-1',
            )}
            style={{ boxShadow: '0 6px 16px -4px rgba(0,0,0,0.5)' }}
          >
            Remix
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <line x1="5" y1="12" x2="19" y2="12" />
              <polyline points="12 5 19 12 12 19" />
            </svg>
          </div>
        </div>
      </div>
    </motion.button>
  );
}
