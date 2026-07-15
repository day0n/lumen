'use client';

/**
 * 阶段切换时执行短距离滑入和淡入；键值变化会重新触发入场。
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
