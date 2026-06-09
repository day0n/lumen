'use client';

/**
 * StageFade —— 切换 stage 时的滑入 + 淡入 wrapper。
 *
 * reactbits 的 AnimatedContent 依赖 gsap + ScrollTrigger（项目没装），
 * 而且我们的 stage 切换是用户主动点击触发的（不需要 scroll trigger），
 * 所以用已经装好的 motion 自己实现一个简化版：
 * - 入场：向上 24px + opacity 0 → 落位 + opacity 1
 * - key 改变（stage 切换）就会触发新一轮入场
 * - 200ms 时长，spring 缓出，不抢生成结果的视觉
 */

import { motion } from 'motion/react';
import type { ReactNode } from 'react';

interface StageFadeProps {
  /** 用作 motion 重置入场动画的 key，通常传 activeStep（数字）。 */
  motionKey: string | number;
  children: ReactNode;
  /** 默认 24px 向上滑入。 */
  distance?: number;
  /** 入场时长，默认 0.32s。 */
  duration?: number;
  className?: string;
}

export function StageFade({
  motionKey,
  children,
  distance = 24,
  duration = 0.32,
  className,
}: StageFadeProps) {
  return (
    <motion.div
      key={motionKey}
      initial={{ opacity: 0, y: distance }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration, ease: [0.22, 1, 0.36, 1] }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
