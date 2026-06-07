'use client';

import { cn } from '@/lib/cn';
import { IconPencil } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { type FormEvent, useEffect, useId, useState } from 'react';

export type PromptDialogProps = {
  open: boolean;
  title: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
};

export function PromptDialog({
  open,
  title,
  defaultValue = '',
  placeholder,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: PromptDialogProps) {
  const inputId = useId();
  const [value, setValue] = useState(defaultValue);

  useEffect(() => {
    if (!open) return;
    setValue(defaultValue);
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
  }, [open, defaultValue, onCancel]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const next = value.trim();
    if (!next) return;
    onConfirm(next);
  };

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
          <motion.form
            initial={{ opacity: 0, y: 16, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, scale: 0.98 }}
            transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
            onSubmit={handleSubmit}
            className="w-full max-w-[420px] overflow-hidden rounded-[20px] bg-[#17191c] p-6 text-white shadow-[0_40px_120px_-50px_rgba(0,0,0,0.95)] ring-1 ring-white/[0.09]"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start gap-3">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.06] text-white/72">
                <IconPencil size={20} stroke={2.1} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="text-[17px] font-bold text-white">{title}</h2>
                <label htmlFor={inputId} className="sr-only">
                  {title}
                </label>
                <input
                  id={inputId}
                  autoFocus
                  value={value}
                  onChange={(event) => setValue(event.target.value)}
                  placeholder={placeholder}
                  className={cn(
                    'mt-4 h-11 w-full rounded-xl bg-white/[0.05] px-3.5 text-[14px] text-white outline-none ring-1 ring-white/[0.08] transition-shadow',
                    'placeholder:text-white/32 focus:ring-white/20',
                  )}
                />
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
                type="submit"
                disabled={!value.trim()}
                className="h-10 flex-1 rounded-xl bg-white text-[13px] font-bold text-[#111315] transition-transform hover:bg-white/92 active:scale-[0.97] disabled:opacity-45"
              >
                {confirmLabel}
              </button>
            </div>
          </motion.form>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
