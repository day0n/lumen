'use client';

import { SafeAreaContainer } from '@/components/mobile/SafeAreaContainer';
import { cn } from '@/lib/cn';
import { IconX } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, type ReactNode } from 'react';

interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  /** full = nearly full viewport; auto = content height capped */
  size?: 'auto' | 'full';
  footer?: ReactNode;
}

export function MobileSheet({
  open,
  onClose,
  title,
  children,
  className,
  size = 'auto',
  footer,
}: MobileSheetProps) {
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open ? (
        <div className="fixed inset-0 z-[80] lg:hidden" role="presentation">
          <motion.button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-black/55"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby={title ? 'mobile-sheet-title' : undefined}
            className={cn(
              'absolute inset-x-0 bottom-0 flex max-h-[min(92dvh,100%)] flex-col overflow-hidden rounded-t-[22px] bg-[#151719] text-white shadow-[0_-24px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.1]',
              size === 'full' && 'max-h-[min(96dvh,100%)]',
              className,
            )}
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
              {title ? (
                <h2 id="mobile-sheet-title" className="min-w-0 truncate text-[15px] font-semibold">
                  {title}
                </h2>
              ) : (
                <span className="flex-1" />
              )}
              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white/70 hover:bg-white/[0.08] hover:text-white"
              >
                <IconX size={20} stroke={2.2} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
              {children}
            </div>
            {footer ? (
              <SafeAreaContainer edges="bottom" className="shrink-0 border-t border-white/[0.08] px-4 py-3">
                {footer}
              </SafeAreaContainer>
            ) : (
              <SafeAreaContainer edges="bottom" className="h-0 shrink-0" />
            )}
          </motion.div>
        </div>
      ) : null}
    </AnimatePresence>
  );
}
