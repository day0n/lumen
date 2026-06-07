'use client';

import { cn } from '@/lib/cn';
import { IconAlertTriangle } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect } from 'react';

export type ConfirmDialogProps = {
  open: boolean;
  message: string;
  title?: string;
  confirmLabel: string;
  cancelLabel: string;
  variant?: 'default' | 'danger';
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  message,
  title,
  confirmLabel,
  cancelLabel,
  variant = 'default',
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open, onCancel]);

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/75 px-4 py-8 backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onCancel}
        >
          <motion.div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby={title ? 'confirm-dialog-title' : undefined}
            aria-describedby="confirm-dialog-message"
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
            className="w-full max-w-[420px] overflow-hidden rounded-[20px] bg-[#17191c] p-6 text-white shadow-[0_40px_120px_-50px_rgba(0,0,0,0.95)] ring-1 ring-white/[0.09]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span
                className={cn(
                  'flex h-11 w-11 shrink-0 items-center justify-center rounded-xl',
                  variant === 'danger'
                    ? 'bg-[#ff5d73]/14 text-[#ffabb6]'
                    : 'bg-white/[0.06] text-white/72',
                )}
              >
                <IconAlertTriangle size={20} stroke={2.1} />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                {title ? (
                  <h2 id="confirm-dialog-title" className="text-[17px] font-bold text-white">
                    {title}
                  </h2>
                ) : null}
                <p
                  id="confirm-dialog-message"
                  className={cn(
                    'text-[14px] leading-relaxed text-white/72',
                    title ? 'mt-2' : 'text-white/78',
                  )}
                >
                  {message}
                </p>
              </div>
            </div>

            <div className="mt-6 flex items-center gap-2">
              <button
                type="button"
                onClick={onCancel}
                className="h-10 flex-1 rounded-xl bg-white/[0.05] text-[13px] font-semibold text-white/72 ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.09] hover:text-white"
              >
                {cancelLabel}
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className={cn(
                  'h-10 flex-1 rounded-xl text-[13px] font-bold transition-transform active:scale-[0.97]',
                  variant === 'danger'
                    ? 'bg-[#ff5d73] text-white hover:bg-[#ff6f82]'
                    : 'bg-white text-[#111315] hover:bg-white/92',
                )}
              >
                {confirmLabel}
              </button>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
