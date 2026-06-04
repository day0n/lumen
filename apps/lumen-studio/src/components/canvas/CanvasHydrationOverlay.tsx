'use client';

import { motion } from 'motion/react';
import { useId } from 'react';

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
 *  - 单层轨道 + 中央光束 mark，避免旋转内圈贴近 logo 时看起来像重复图标。
 *  - 退场由父级 AnimatePresence 控制，整体 0.32s 淡出。
 */
export function CanvasHydrationOverlay({ label, hint }: CanvasHydrationOverlayProps) {
  const outerGradientId = `lumen-hydration-outer-${useId().replace(/:/g, '')}`;

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
      <div className="relative h-[112px] w-[112px]">
        <motion.div
          className="absolute inset-[-30px] rounded-full"
          style={{
            background:
              'radial-gradient(circle, rgba(121,228,255,0.18) 0%, rgba(245,199,106,0.1) 32%, transparent 70%)',
            filter: 'blur(14px)',
          }}
          animate={{ scale: [0.96, 1.08, 0.96], opacity: [0.48, 0.82, 0.48] }}
          transition={{ duration: 2.8, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
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
          transition={{ duration: 1.8, ease: 'linear', repeat: Number.POSITIVE_INFINITY }}
          aria-hidden="true"
          role="presentation"
        >
          <title>Hydration outer arc</title>
          <defs>
            <linearGradient id={outerGradientId} x1="0%" y1="0%" x2="100%" y2="0%">
              <stop offset="0%" stopColor="rgba(121,228,255,0)" />
              <stop offset="46%" stopColor="rgba(121,228,255,0.9)" />
              <stop offset="100%" stopColor="rgba(245,199,106,0.95)" />
            </linearGradient>
          </defs>
          <circle
            cx="50"
            cy="50"
            r="44"
            fill="none"
            stroke={`url(#${outerGradientId})`}
            strokeWidth="2.6"
            strokeLinecap="round"
            strokeDasharray="118 278"
          />
        </motion.svg>

        <motion.div
          className="absolute inset-0 flex items-center justify-center"
          animate={{ scale: [1, 1.045, 1] }}
          transition={{
            duration: 2,
            repeat: Number.POSITIVE_INFINITY,
            ease: 'easeInOut',
          }}
        >
          <HydrationMark />
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

function HydrationMark() {
  const idPrefix = `lumen-loading-mark-${useId().replace(/:/g, '')}`;
  const glowId = `${idPrefix}-glow`;
  const tileId = `${idPrefix}-tile`;
  const beamId = `${idPrefix}-beam`;

  return (
    <svg
      className="h-[52px] w-[52px] drop-shadow-[0_16px_34px_rgba(0,0,0,0.34)]"
      viewBox="0 0 52 52"
      aria-hidden="true"
      role="presentation"
    >
      <title>Lumen loading mark</title>
      <defs>
        <radialGradient id={glowId} cx="36%" cy="28%" r="72%">
          <stop offset="0%" stopColor="#fff0a8" />
          <stop offset="34%" stopColor="#79e4ff" />
          <stop offset="70%" stopColor="#5067ff" />
          <stop offset="100%" stopColor="#171b24" />
        </radialGradient>
        <linearGradient id={tileId} x1="8" x2="44" y1="6" y2="46">
          <stop offset="0%" stopColor="rgba(255,255,255,0.9)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0.2)" />
        </linearGradient>
        <linearGradient id={beamId} x1="15" x2="38" y1="14" y2="39">
          <stop offset="0%" stopColor="rgba(255,255,255,0.95)" />
          <stop offset="48%" stopColor="rgba(255,255,255,0.32)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </linearGradient>
      </defs>
      <rect
        x="7"
        y="7"
        width="38"
        height="38"
        rx="14"
        fill={`url(#${glowId})`}
        stroke={`url(#${tileId})`}
        strokeWidth="1.2"
      />
      <path
        d="M16 33.5V18.8c0-1.7 1.9-2.8 3.4-1.9l13 7.3c1.5.9 1.5 3 0 3.9l-13 7.4c-1.5.8-3.4-.3-3.4-2z"
        fill="rgba(4,10,16,0.42)"
      />
      <path
        d="M17.8 31.2V21.1c0-1.1 1.2-1.8 2.1-1.2l8.8 5c.9.5.9 1.9 0 2.4l-8.8 5c-.9.6-2.1-.1-2.1-1.3z"
        fill={`url(#${beamId})`}
      />
      <path
        d="M13.4 12.6h13.8c5.1 0 9.1 1.4 11.7 4.6"
        fill="none"
        stroke="rgba(255,255,255,0.48)"
        strokeLinecap="round"
        strokeWidth="1.35"
      />
    </svg>
  );
}
