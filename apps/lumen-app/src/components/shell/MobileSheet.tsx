'use client';

import { SafeAreaContainer } from '@app/components/shell/SafeAreaContainer';
import { cn } from '@app/lib/cn';
import { IconX } from '@tabler/icons-react';
import { type ReactNode, useEffect, useId, useRef } from 'react';

interface MobileSheetProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  className?: string;
  size?: 'auto' | 'full';
  footer?: ReactNode;
  closeLabel?: string;
}

export function MobileSheet({
  open,
  onClose,
  title,
  children,
  className,
  size = 'auto',
  footer,
  closeLabel = 'Close',
}: MobileSheetProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    const dialog = dialogRef.current;
    if (!dialog) return;

    dialog.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
      if (dialog.open) dialog.close();
    };
  }, [open]);

  if (!open) return null;

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={title ? titleId : undefined}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === dialogRef.current) onClose();
      }}
      onKeyDown={(event) => {
        if (event.target !== dialogRef.current) return;
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClose();
        }
      }}
      className={cn(
        'fixed inset-0 z-[80] m-0 flex h-dvh w-full max-w-none flex-col justify-end border-0 bg-transparent p-0 backdrop:bg-black/55 lg:hidden',
        className,
      )}
    >
      <div
        className={cn(
          'flex max-h-[min(92dvh,100%)] w-full flex-col overflow-hidden rounded-t-[22px] bg-[#151719] text-white shadow-[0_-24px_80px_rgba(0,0,0,0.55)] ring-1 ring-white/[0.1]',
          size === 'full' && 'max-h-[min(96dvh,100%)]',
        )}
      >
        <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.08] px-4 py-3">
          {title ? (
            <h2 id={titleId} className="min-w-0 truncate text-[15px] font-semibold">
              {title}
            </h2>
          ) : (
            <span className="flex-1" />
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label={closeLabel}
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-xl text-white/70 hover:bg-white/[0.08] hover:text-white"
          >
            <IconX size={20} stroke={2.2} />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4">
          {children}
        </div>
        {footer ? (
          <SafeAreaContainer
            edges="bottom"
            className="shrink-0 border-t border-white/[0.08] px-4 py-3"
          >
            {footer}
          </SafeAreaContainer>
        ) : (
          <SafeAreaContainer edges="bottom" className="h-0 shrink-0" />
        )}
      </div>
    </dialog>
  );
}
