'use client';

import { cn } from '@/lib/cn';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';

export function CanvasRotatingLabel({
  messages,
  delay = 3000,
  className,
}: {
  messages: string[];
  delay?: number;
  className?: string;
}) {
  const [index, setIndex] = useState(0);
  const reducedMotion = usePrefersReducedMotion();
  const longestMessage = messages.reduce((longest, message) =>
    message.length > longest.length ? message : longest,
  );

  useEffect(() => {
    if (reducedMotion || messages.length <= 1) return;
    const intervalId = window.setInterval(() => {
      setIndex((current) => (current + 1) % messages.length);
    }, delay);
    return () => window.clearInterval(intervalId);
  }, [delay, messages.length, reducedMotion]);

  return (
    <div className={cn('relative', className)}>
      <span className="invisible whitespace-nowrap text-sm font-medium">{longestMessage}</span>
      <AnimatePresence initial={false} mode="wait">
        <motion.span
          key={reducedMotion ? messages[0] : messages[index]}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
          className="canvas-entry-label absolute inset-0 whitespace-nowrap text-sm font-medium"
        >
          {reducedMotion ? messages[0] : messages[index]}
        </motion.span>
      </AnimatePresence>
    </div>
  );
}

function usePrefersReducedMotion() {
  const [reducedMotion, setReducedMotion] = useState(false);

  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(mediaQuery.matches);
    update();
    mediaQuery.addEventListener('change', update);
    return () => mediaQuery.removeEventListener('change', update);
  }, []);

  return reducedMotion;
}
