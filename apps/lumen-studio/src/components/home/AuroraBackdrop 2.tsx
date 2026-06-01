'use client';

import { motion } from 'motion/react';

/**
 * 全屏极光背景。多层 blob 缓慢漂移，给页面"在呼吸"的感觉。
 * 注意：使用 motion 的 transform 单位，避免 layout 重算。
 */
export function AuroraBackdrop() {
  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 overflow-hidden"
      style={{ contain: 'strict' }}
    >
      {/* 主光团 — 朱红 */}
      <motion.div
        className="absolute -left-[20%] -top-[10%] h-[70vh] w-[70vh] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(255,77,46,0.32) 0%, rgba(255,77,46,0.08) 35%, transparent 70%)',
          filter: 'blur(80px)',
        }}
        animate={{
          x: ['0%', '12%', '0%'],
          y: ['0%', '8%', '0%'],
        }}
        transition={{
          duration: 22,
          repeat: Number.POSITIVE_INFINITY,
          ease: 'easeInOut',
        }}
      />

      {/* 次光团 — 流明金 */}
      <motion.div
        className="absolute right-[-15%] top-[20%] h-[60vh] w-[60vh] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(255,176,42,0.22) 0%, rgba(255,176,42,0.04) 40%, transparent 70%)',
          filter: 'blur(90px)',
        }}
        animate={{
          x: ['0%', '-10%', '0%'],
          y: ['0%', '12%', '0%'],
        }}
        transition={{
          duration: 28,
          repeat: Number.POSITIVE_INFINITY,
          ease: 'easeInOut',
        }}
      />

      {/* 远光团 — 紫罗兰，提供色彩对比 */}
      <motion.div
        className="absolute left-[30%] bottom-[-20%] h-[55vh] w-[55vh] rounded-full"
        style={{
          background:
            'radial-gradient(circle, rgba(149,103,255,0.16) 0%, rgba(149,103,255,0.03) 45%, transparent 70%)',
          filter: 'blur(100px)',
        }}
        animate={{
          x: ['0%', '-8%', '0%'],
          y: ['0%', '-6%', '0%'],
        }}
        transition={{
          duration: 32,
          repeat: Number.POSITIVE_INFINITY,
          ease: 'easeInOut',
        }}
      />

      {/* 顶部 vignette，给 topbar 一个暗化区让玻璃面板更清晰 */}
      <div
        className="absolute inset-x-0 top-0 h-32"
        style={{
          background: 'linear-gradient(to bottom, rgba(7,5,3,0.6), transparent)',
        }}
      />
    </div>
  );
}
