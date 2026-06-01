'use client';

import { motion } from 'motion/react';
import { useState } from 'react';
import { cn } from '@/lib/cn';

const QUICK_PROMPTS = [
  '夏日防晒蚕丝面膜',
  '磁吸无线耳机 Pro',
  '有机藜麦能量棒',
  '复古牛仔外套',
];

export function Hero() {
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);

  return (
    <section className="relative mx-auto max-w-[1100px] px-6 pt-12 pb-10 text-center">
      {/* 顶部 eyebrow */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.32, 0.72, 0, 1] }}
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1 text-[11px] uppercase tracking-[0.2em] text-white/60 backdrop-blur"
      >
        <span
          aria-hidden
          className="block h-1 w-1 rounded-full bg-flame-500"
          style={{ boxShadow: '0 0 8px #ff4d2e' }}
        />
        AIGC 一键成片 · 火山方舟驱动
      </motion.div>

      {/* 主标题 */}
      <motion.h1
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.05, ease: [0.32, 0.72, 0, 1] }}
        className="font-display mt-7 text-[60px] font-bold leading-[1.04] tracking-[-0.03em] text-white"
        style={{ textShadow: '0 4px 40px rgba(255,77,46,0.15)' }}
      >
        把商品链接，
        <br />
        <span className="text-flame">变成一束爆款的光</span>
      </motion.h1>

      <motion.p
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.15, ease: [0.32, 0.72, 0, 1] }}
        className="mx-auto mt-5 max-w-[560px] text-[15px] leading-[1.6] text-white/55"
      >
        粘贴 TikTok Shop 链接 · 上传商品主图 · 自然语言描述
        <br />
        Agent 在画布上自动搭工作流，30 秒拿到第一条带货视频
      </motion.p>

      {/* 输入框 */}
      <motion.div
        initial={{ opacity: 0, y: 24 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.25, ease: [0.32, 0.72, 0, 1] }}
        className="relative mx-auto mt-10 max-w-[680px]"
      >
        {/* 输入框外发光 */}
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -inset-2 rounded-[22px] opacity-0"
          animate={{ opacity: focused ? 1 : 0 }}
          transition={{ duration: 0.4 }}
          style={{
            background:
              'radial-gradient(80% 100% at 50% 50%, rgba(255,77,46,0.35), transparent 70%)',
            filter: 'blur(20px)',
          }}
        />

        <div
          className={cn(
            'glass glass-edge relative flex items-center gap-3 rounded-[18px] p-2.5 transition-all',
            focused && 'shadow-[0_0_0_1px_rgba(255,122,74,0.4),0_24px_48px_-12px_rgba(255,77,46,0.4)]',
          )}
        >
          {/* 朱红 leading icon */}
          <div
            className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl"
            style={{
              background: 'linear-gradient(135deg, #ffb02a 0%, #ff4d2e 100%)',
              boxShadow:
                '0 8px 16px -4px rgba(255,77,46,0.5), inset 0 1px 0 rgba(255,255,255,0.18)',
            }}
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round">
              <path d="M9 17H7A5 5 0 0 1 7 7h2" />
              <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
              <line x1="8" y1="12" x2="16" y2="12" />
            </svg>
          </div>

          <input
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            placeholder="https://shop.tiktok.com/...   或描述你的商品"
            className="flex-1 bg-transparent text-[15px] text-white outline-none placeholder:text-white/30"
          />

          {/* 附件按钮 */}
          <button
            type="button"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-white/40 transition-colors hover:bg-white/[0.06] hover:text-white/80"
            aria-label="上传图片"
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48" />
            </svg>
          </button>

          {/* CTA */}
          <button
            type="button"
            className="group relative overflow-hidden rounded-xl px-5 py-2.5 text-[13px] font-semibold text-white"
            style={{
              background: 'linear-gradient(135deg, #ff7a4a 0%, #ff4d2e 60%, #c4220e 100%)',
              boxShadow: '0 8px 24px -4px rgba(255,77,46,0.55)',
            }}
          >
            <span className="relative z-10 flex items-center gap-1.5">
              立即生成
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </span>
            <span
              aria-hidden
              className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.2), transparent 50%)',
              }}
            />
          </button>
        </div>

        {/* Quick prompts */}
        <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
          <span className="text-[11.5px] text-white/40">试试 →</span>
          {QUICK_PROMPTS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setValue(prompt)}
              className="rounded-full border border-white/8 bg-white/[0.03] px-3 py-1 text-[11.5px] text-white/65 backdrop-blur transition-all hover:border-flame-500/30 hover:bg-flame-500/5 hover:text-white"
            >
              {prompt}
            </button>
          ))}
        </div>
      </motion.div>

      {/* 底部状态条 */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.5 }}
        className="mt-8 flex items-center justify-center gap-6 text-[11px] text-white/35"
      >
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="block h-1.5 w-1.5 rounded-full bg-emerald-400"
            style={{ boxShadow: '0 0 6px #34d399' }}
          />
          系统正常
        </span>
        <span>今日已生成 12,438 条</span>
        <span>平均出片 38 秒</span>
      </motion.div>
    </section>
  );
}
