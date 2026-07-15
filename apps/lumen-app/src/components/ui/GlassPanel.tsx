'use client';

import { cn } from '@/lib/cn';
import { motion } from 'motion/react';

/**
 * 液态玻璃面板基础组件。所有能"漂浮"的容器都从这里派生。
 *
 * - variant: soft | default | strong   控制模糊度与透明度
 * - glow: 是否在悬停/聚焦时透出朱红环光
 * - interactive: 鼠标悬停时上浮 + 边缘高亮
 */
interface GlassPanelProps {
  children: React.ReactNode;
  className?: string;
  variant?: 'soft' | 'default' | 'strong';
  glow?: boolean;
  interactive?: boolean;
  as?: 'div' | 'button' | 'a';
}

const variantClass = {
  soft: 'glass-soft',
  default: 'glass',
  strong: 'glass-strong',
} as const;

export function GlassPanel({
  children,
  className,
  variant = 'default',
  glow = false,
  interactive = false,
  as: As = 'div',
}: GlassPanelProps) {
  const Component = motion[As] as typeof motion.div;

  return (
    <Component
      className={cn(
        'glass-edge relative overflow-hidden rounded-2xl',
        variantClass[variant],
        glow && 'transition-shadow hover:ring-flame',
        interactive && 'cursor-pointer transition-transform',
        className,
      )}
      whileHover={interactive ? { y: -2 } : undefined}
      transition={{ duration: 0.3, ease: [0.32, 0.72, 0, 1] }}
    >
      {/* 顶部高光：模拟玻璃曲率 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px opacity-60"
        style={{
          background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent)',
        }}
      />
      {children}
    </Component>
  );
}
