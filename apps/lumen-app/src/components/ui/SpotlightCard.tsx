'use client';

import { cn } from '@/lib/cn';
import { type ReactNode, useRef, useState } from 'react';

export interface SpotlightCardProps {
  children: ReactNode;
  className?: string;
  spotlightColor?: string;
}

export function SpotlightCard({
  children,
  className,
  spotlightColor = 'rgba(121, 228, 255, 0.22)',
}: SpotlightCardProps) {
  const divRef = useRef<HTMLDivElement>(null);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [opacity, setOpacity] = useState(0);

  return (
    <div
      ref={divRef}
      onMouseMove={(event) => {
        if (!divRef.current) return;
        const rect = divRef.current.getBoundingClientRect();
        setPosition({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      }}
      onMouseEnter={() => setOpacity(1)}
      onMouseLeave={() => setOpacity(0)}
      className={cn('relative overflow-hidden', className)}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 transition-opacity duration-500 ease-out"
        style={{
          opacity: opacity * 0.85,
          background: `radial-gradient(520px circle at ${position.x}px ${position.y}px, ${spotlightColor}, transparent 62%)`,
        }}
      />
      <div className="relative z-[1]">{children}</div>
    </div>
  );
}
