'use client';

import { LumenMark } from '@/components/ui/LumenMark';
import { cn } from '@/lib/cn';
import { motion } from 'motion/react';

const navItems = [
  { label: '主页', active: true },
  { label: '工作室' },
  { label: '素材库' },
  { label: '爆款参考' },
];

export function Topbar() {
  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <div className="mx-auto flex max-w-[1440px] items-center gap-6 px-6 pt-4">
        {/* Logo */}
        <div className="flex items-center gap-3">
          <LumenMark size={36} />
          <div className="flex flex-col leading-none">
            <span className="font-display text-[17px] font-bold tracking-tight text-white">
              Lumen
            </span>
            <span className="mt-0.5 text-[10px] uppercase tracking-[0.18em] text-white/40">
              streamer studio
            </span>
          </div>
        </div>

        {/* 浮岛导航 */}
        <nav className="glass glass-edge ml-6 flex items-center gap-0.5 rounded-full p-1">
          {navItems.map((item) => (
            <button
              key={item.label}
              type="button"
              className={cn(
                'relative rounded-full px-4 py-2 text-[13px] font-medium transition-colors',
                item.active ? 'text-white' : 'text-white/60 hover:text-white/90',
              )}
            >
              {item.active && (
                <motion.div
                  layoutId="nav-active"
                  className="absolute inset-0 rounded-full bg-white/10"
                  style={{
                    boxShadow:
                      'inset 0 1px 0 rgba(255,255,255,0.12), 0 4px 16px -4px rgba(255,77,46,0.3)',
                  }}
                  transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                />
              )}
              <span className="relative z-10">{item.label}</span>
            </button>
          ))}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          {/* 积分 */}
          <div className="glass glass-edge flex items-center gap-2 rounded-full px-3.5 py-2 text-[12px]">
            <span
              aria-hidden
              className="block h-1.5 w-1.5 rounded-full bg-glow-400"
              style={{ boxShadow: '0 0 8px rgba(255,176,42,0.8)' }}
            />
            <span className="font-medium text-glow-300">1,280</span>
            <span className="text-white/40">流明</span>
          </div>

          {/* CTA */}
          <button
            type="button"
            className={cn(
              'group relative overflow-hidden rounded-full px-4 py-2 text-[12.5px] font-semibold text-white',
              'ring-flame transition-transform active:scale-[0.97]',
            )}
            style={{
              background: 'linear-gradient(135deg, #ff7a4a 0%, #ff4d2e 60%, #c4220e 100%)',
            }}
          >
            <span className="relative z-10 flex items-center gap-1.5">
              <span>+</span>
              新建视频
            </span>
            <span
              aria-hidden
              className="absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
              style={{
                background: 'linear-gradient(135deg, rgba(255,255,255,0.18), transparent 50%)',
              }}
            />
          </button>

          {/* 头像 */}
          <div
            className="h-9 w-9 rounded-full ring-2 ring-white/15 ring-offset-2 ring-offset-[#0c0a07]"
            style={{
              background: 'linear-gradient(135deg, #b48fff, #ff4d2e)',
            }}
          />
        </div>
      </div>
    </header>
  );
}
