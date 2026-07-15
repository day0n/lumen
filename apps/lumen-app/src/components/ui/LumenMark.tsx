'use client';

import { cn } from '@/lib/cn';
import { motion } from 'motion/react';

/**
 * Lumen 流明 Logo — 一束被点亮的光斑。
 * 中心椭圆 + 朱红辉光环 + 微微旋转，传达"光的容器"。
 */
export function LumenMark({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <motion.div
      className={cn('relative shrink-0', className)}
      style={{ width: size, height: size }}
      whileHover={{ rotate: 6, scale: 1.06 }}
      transition={{ type: 'spring', stiffness: 220, damping: 14 }}
    >
      {/* 外层辉光 */}
      <div
        className="absolute inset-0 rounded-[28%]"
        style={{
          background: 'radial-gradient(circle at 35% 30%, #f5c76a, #79e4ff 58%, #5067ff)',
          boxShadow:
            '0 8px 24px -4px rgba(121,228,255,0.42), 0 0 0 1px rgba(255,255,255,0.12) inset',
        }}
      />
      {/* 内部光斑高光 */}
      <div
        className="absolute rounded-full"
        style={{
          left: '22%',
          top: '18%',
          width: '38%',
          height: '38%',
          background:
            'radial-gradient(circle, rgba(255,255,255,0.85) 0%, rgba(255,255,255,0.2) 50%, transparent 70%)',
          filter: 'blur(2px)',
        }}
      />
      {/* 顶部反光弧 */}
      <div
        className="absolute inset-x-[14%] top-[8%] h-[3px] rounded-full"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.6), transparent)',
        }}
      />
    </motion.div>
  );
}
