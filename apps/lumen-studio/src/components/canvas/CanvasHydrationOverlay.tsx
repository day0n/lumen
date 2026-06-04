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
 *  - 视觉上只保留一个彩色有机 bloom，不再渲染任何可见文案。
 *  - 退场由父级 AnimatePresence 控制，整体 0.32s 淡出。
 */
export function CanvasHydrationOverlay({ label, hint }: CanvasHydrationOverlayProps) {
  const ariaLabel = hint ? `${label}. ${hint}` : label;

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
      // biome-ignore lint/a11y/useSemanticElements: 这是一个进度遮罩，需要 motion.div 才能驱动入退场动画。
      role="status"
      aria-busy="true"
      aria-label={ariaLabel}
      aria-live="polite"
    >
      <div className="relative h-[214px] w-[214px] sm:h-[260px] sm:w-[260px]">
        <motion.div
          className="absolute inset-4 rounded-full"
          style={{
            background:
              'radial-gradient(circle, rgba(121,228,255,0.18) 0%, rgba(255,117,68,0.14) 38%, transparent 72%)',
            filter: 'blur(32px)',
          }}
          animate={{ scale: [0.88, 1.08, 0.88], opacity: [0.45, 0.78, 0.45] }}
          transition={{ duration: 3.4, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
        />
        <HydrationBloomMark className="relative h-full w-full" />
      </div>
    </motion.div>
  );
}

export function HydrationBloomMark({ className = 'h-[240px] w-[240px]' }: { className?: string }) {
  const idPrefix = `lumen-loading-bloom-${useId().replace(/:/g, '')}`;
  const clipId = `${idPrefix}-clip`;
  const shellId = `${idPrefix}-shell`;
  const cyanId = `${idPrefix}-cyan`;
  const blueId = `${idPrefix}-blue`;
  const goldId = `${idPrefix}-gold`;
  const coralId = `${idPrefix}-coral`;
  const violetId = `${idPrefix}-violet`;
  const mintId = `${idPrefix}-mint`;
  const centerId = `${idPrefix}-center`;
  const highlightId = `${idPrefix}-highlight`;
  const shadowId = `${idPrefix}-shadow`;
  const softGlowId = `${idPrefix}-soft-glow`;
  const shellPath =
    'M117 17C143 13 154 43 172 58C191 73 224 72 225 101C226 125 197 133 189 149C205 171 188 200 160 190C141 183 139 222 112 220C88 218 92 184 75 177C52 190 26 169 38 142C44 128 18 111 28 88C38 65 65 74 80 61C88 42 96 20 117 17Z';

  return (
    <motion.svg
      className={className}
      viewBox="0 0 240 240"
      aria-hidden="true"
      role="presentation"
      animate={{ rotate: [0, -2.8, 2.2, 0], scale: [1, 1.03, 0.995, 1] }}
      transition={{ duration: 5.2, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
      style={{
        filter: 'drop-shadow(0 22px 48px rgba(0,0,0,0.42)) saturate(1.12)',
      }}
    >
      <defs>
        <clipPath id={clipId}>
          <path d={shellPath} />
        </clipPath>
        <radialGradient id={shellId} cx="44%" cy="38%" r="72%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.78)" />
          <stop offset="38%" stopColor="rgba(121,228,255,0.4)" />
          <stop offset="72%" stopColor="rgba(255,126,54,0.32)" />
          <stop offset="100%" stopColor="rgba(32,20,58,0.55)" />
        </radialGradient>
        <radialGradient id={cyanId} cx="35%" cy="26%" r="76%">
          <stop offset="0%" stopColor="#ecfff1" />
          <stop offset="38%" stopColor="#55f0ff" />
          <stop offset="72%" stopColor="#1472ff" />
          <stop offset="100%" stopColor="#1730a4" />
        </radialGradient>
        <radialGradient id={blueId} cx="44%" cy="28%" r="82%">
          <stop offset="0%" stopColor="#c9fbff" />
          <stop offset="42%" stopColor="#48a9ff" />
          <stop offset="78%" stopColor="#2147ff" />
          <stop offset="100%" stopColor="#18206e" />
        </radialGradient>
        <radialGradient id={goldId} cx="48%" cy="30%" r="78%">
          <stop offset="0%" stopColor="#fff1bd" />
          <stop offset="42%" stopColor="#ffc75c" />
          <stop offset="76%" stopColor="#ff8a00" />
          <stop offset="100%" stopColor="#854402" />
        </radialGradient>
        <radialGradient id={coralId} cx="46%" cy="34%" r="82%">
          <stop offset="0%" stopColor="#ffd1cb" />
          <stop offset="42%" stopColor="#ff6e61" />
          <stop offset="72%" stopColor="#ff2d86" />
          <stop offset="100%" stopColor="#5b1549" />
        </radialGradient>
        <radialGradient id={violetId} cx="43%" cy="28%" r="82%">
          <stop offset="0%" stopColor="#f2d7ff" />
          <stop offset="42%" stopColor="#b77bff" />
          <stop offset="72%" stopColor="#6138ff" />
          <stop offset="100%" stopColor="#231369" />
        </radialGradient>
        <radialGradient id={mintId} cx="38%" cy="32%" r="78%">
          <stop offset="0%" stopColor="#f5ffd8" />
          <stop offset="36%" stopColor="#8cffc7" />
          <stop offset="72%" stopColor="#25c9ff" />
          <stop offset="100%" stopColor="#075c81" />
        </radialGradient>
        <radialGradient id={centerId} cx="36%" cy="32%" r="76%">
          <stop offset="0%" stopColor="#f8fff0" />
          <stop offset="34%" stopColor="#93fff5" />
          <stop offset="66%" stopColor="#1556ff" />
          <stop offset="100%" stopColor="#251066" />
        </radialGradient>
        <radialGradient id={highlightId} cx="40%" cy="35%" r="68%">
          <stop offset="0%" stopColor="rgba(255,255,255,0.92)" />
          <stop offset="48%" stopColor="rgba(255,255,255,0.26)" />
          <stop offset="100%" stopColor="rgba(255,255,255,0)" />
        </radialGradient>
        <radialGradient id={shadowId} cx="52%" cy="60%" r="64%">
          <stop offset="0%" stopColor="rgba(14,8,56,0.64)" />
          <stop offset="58%" stopColor="rgba(14,8,56,0.2)" />
          <stop offset="100%" stopColor="rgba(14,8,56,0)" />
        </radialGradient>
        <filter id={softGlowId} x="-35%" y="-35%" width="170%" height="170%">
          <feGaussianBlur in="SourceGraphic" result="blur" stdDeviation="5" />
          <feColorMatrix
            in="blur"
            result="glow"
            type="matrix"
            values="1.08 0 0 0 0 0 1.05 0 0 0 0 0 1.2 0 0 0 0 0 .42 0"
          />
          <feMerge>
            <feMergeNode in="glow" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      <path d={shellPath} fill={`url(#${shellId})`} opacity="0.72" />
      <g clipPath={`url(#${clipId})`} filter={`url(#${softGlowId})`}>
        <ellipse cx="119" cy="69" rx="37" ry="76" fill={`url(#${blueId})`} opacity="0.76" />
        <ellipse
          cx="166"
          cy="82"
          rx="36"
          ry="76"
          fill={`url(#${goldId})`}
          opacity="0.78"
          transform="rotate(48 120 120)"
        />
        <ellipse
          cx="179"
          cy="125"
          rx="38"
          ry="78"
          fill={`url(#${coralId})`}
          opacity="0.78"
          transform="rotate(88 120 120)"
        />
        <ellipse
          cx="155"
          cy="169"
          rx="38"
          ry="78"
          fill={`url(#${violetId})`}
          opacity="0.76"
          transform="rotate(136 120 120)"
        />
        <ellipse
          cx="112"
          cy="179"
          rx="38"
          ry="76"
          fill={`url(#${cyanId})`}
          opacity="0.72"
          transform="rotate(178 120 120)"
        />
        <ellipse
          cx="74"
          cy="157"
          rx="39"
          ry="78"
          fill={`url(#${mintId})`}
          opacity="0.76"
          transform="rotate(225 120 120)"
        />
        <ellipse
          cx="62"
          cy="113"
          rx="38"
          ry="78"
          fill={`url(#${goldId})`}
          opacity="0.72"
          transform="rotate(272 120 120)"
        />
        <ellipse
          cx="83"
          cy="78"
          rx="38"
          ry="76"
          fill={`url(#${mintId})`}
          opacity="0.72"
          transform="rotate(316 120 120)"
        />
        <path
          d="M64 117C82 91 104 86 123 101C139 114 134 142 114 153C89 166 56 150 64 117Z"
          fill={`url(#${cyanId})`}
          opacity="0.82"
        />
        <path
          d="M127 89C151 75 182 87 188 116C194 145 163 157 141 144C118 131 108 101 127 89Z"
          fill={`url(#${coralId})`}
          opacity="0.72"
        />
        <path
          d="M91 140C106 119 137 121 153 139C170 159 154 185 128 187C100 190 76 164 91 140Z"
          fill={`url(#${violetId})`}
          opacity="0.68"
        />
        <ellipse cx="120" cy="121" rx="45" ry="40" fill={`url(#${centerId})`} opacity="0.94" />
        <ellipse
          cx="96"
          cy="125"
          rx="39"
          ry="35"
          fill={`url(#${highlightId})`}
          opacity="0.78"
          transform="rotate(-19 96 125)"
        />
        <ellipse cx="133" cy="121" rx="36" ry="34" fill={`url(#${shadowId})`} opacity="0.74" />
      </g>
      <path
        d={shellPath}
        fill="none"
        stroke="rgba(255,255,255,0.16)"
        strokeWidth="1.4"
      />
    </motion.svg>
  );
}
