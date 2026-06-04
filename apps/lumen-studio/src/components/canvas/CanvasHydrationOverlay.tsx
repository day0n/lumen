'use client';

import { motion } from 'motion/react';

import { LumenMark } from '@/components/ui/LumenMark';

interface CanvasHydrationOverlayProps {
  /** 主提示文案，例如「正在唤醒工作流」 */
  label: string;
  /** 副标题，例如「Loading nodes onto canvas」 */
  hint?: string;
}

/**
 * 画布点开后的过渡 / 等待动画。
 * 设计要点：
 *  - 整屏覆盖深色磨砂背景，避免出现"先看到空白画布、再看到节点跳出来"的割裂感。
 *  - 双层 conic 光环以不同速度反向旋转，配合中央 LumenMark 的呼吸缩放，传达
 *    「光在汇聚」的品牌感受。
 *  - 退场由父级 AnimatePresence 控制，整体 0.32s 淡出。
 */
export function CanvasHydrationOverlay({ label, hint }: CanvasHydrationOverlayProps) {
  return (
    <motion.div
      initial={{ opacity: 1 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
      className="pointer-events-auto absolute inset-0 z-[60] flex flex-col items-center justify-center"
      style={{
        background:
          'radial-gradient(circle at 50% 38%, rgba(15,22,30,0.94) 0%, rgba(5,6,7,0.97) 62%)',
        backdropFilter: 'blur(10px)',
        WebkitBackdropFilter: 'blur(10px)',
      }}
      // biome-ignore lint/a11y/useSemanticElements: 这是一个进度遮罩，需要 motion.div 才能驱动入退场动画，
      // 用 <output> 元素会失去 framer-motion 的能力，因此显式声明 role="status"。
      role="status"
      aria-busy="true"
      aria-live="polite"
    >
      <div className="relative h-[108px] w-[108px]">
        <motion.div
          className="absolute inset-[-26px] rounded-full"
          style={{
            background:
              'radial-gradient(circle, rgba(121,228,255,0.22) 0%, rgba(80,103,255,0.12) 38%, transparent 72%)',
            filter: 'blur(10px)',
          }}
          animate={{ scale: [0.92, 1.06, 0.92], opacity: [0.55, 0.9, 0.55] }}
          transition={{ duration: 2.4, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
        />

        <svg
          className="pointer-events-none absolute inset-0"
          viewBox="0 0 100 100"
          aria-hidden="true"
          role="presentation"
        >
          <title>Hydration ring track</title>
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="rgba(255,255,255,0.06)"
            strokeWidth="1.6"
          />
        </svg>

        <motion.svg
          className="absolute inset-0"
          viewBox="0 0 100 100"
          animate={{ rotate: 360 }}
          transition={{ duration: 1.5, ease: 'linear', repeat: Number.POSITIVE_INFINITY }}
          aria-hidden="true"
          role="presentation"
        >
          <title>Hydration outer arc</title>
          <defs>
            <linearGradient id="lumen-hydration-outer" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(121,228,255,0)" />
              <stop offset="55%" stopColor="rgba(121,228,255,0.85)" />
              <stop offset="100%" stopColor="rgba(245,199,106,1)" />
            </linearGradient>
          </defs>
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke="url(#lumen-hydration-outer)"
            strokeWidth="2.4"
            strokeLinecap="round"
            strokeDasharray="130 270"
          />
        </motion.svg>

        <motion.svg
          className="absolute inset-[16px]"
          viewBox="0 0 100 100"
          animate={{ rotate: -360 }}
          transition={{ duration: 2.2, ease: 'linear', repeat: Number.POSITIVE_INFINITY }}
          aria-hidden="true"
          role="presentation"
        >
          <title>Hydration inner arc</title>
          <defs>
            <linearGradient id="lumen-hydration-inner" x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(80,103,255,0)" />
              <stop offset="100%" stopColor="rgba(157,168,255,0.85)" />
            </linearGradient>
          </defs>
          <circle
            cx="50"
            cy="50"
            r="36"
            fill="none"
            stroke="url(#lumen-hydration-inner)"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeDasharray="76 230"
          />
        </motion.svg>

        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          animate={{ scale: [1, 1.07, 1] }}
          transition={{
            duration: 1.8,
            repeat: Number.POSITIVE_INFINITY,
            ease: 'easeInOut',
          }}
        >
          <LumenMark size={40} />
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12, duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
        className="mt-8 text-[12px] font-bold uppercase tracking-[0.34em] text-white/55"
      >
        {label}
      </motion.div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 0.5 }}
        transition={{ delay: 0.22, duration: 0.45 }}
        className="mt-2.5 h-px w-[140px] bg-gradient-to-r from-transparent via-white/35 to-transparent"
      />

      {hint ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.28, duration: 0.4 }}
          className="mt-3 text-[12px] font-medium text-white/38"
        >
          {hint}
        </motion.div>
      ) : null}
    </motion.div>
  );
}
