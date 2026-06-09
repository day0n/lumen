'use client';

/**
 * 图片放大查看：
 * - 折叠态是一个浮在图片右上角的小方框按钮（24x24，IconArrowsMaximize 图标）。
 * - 点击打开全屏 lightbox：半透明遮罩 + 原图 contain 居中（不放大也不裁剪）。
 *   ESC / 点击遮罩 / 点击右上角 X 都可关闭。
 *
 * 用 native <dialog open> 而不是 portal，确保 a11y 正确且 z-index 不出问题。
 */

import { IconArrowsMaximize, IconX } from '@tabler/icons-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';

interface ImageZoomButtonProps {
  src: string;
  alt?: string;
  /** 浮按钮额外 className，调用方可以覆盖位置 / 颜色。 */
  className?: string;
  /** lightbox 顶部小字描述（可选）。 */
  caption?: string;
  openLabel?: string;
  closeLabel?: string;
  dialogLabel?: string;
}

export function ImageZoomButton({
  src,
  alt = '',
  className,
  caption,
  openLabel = 'Open image preview',
  closeLabel = 'Close',
  dialogLabel = 'Image preview',
}: ImageZoomButtonProps) {
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const handle = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        onClick={(event) => {
          event.stopPropagation();
          setOpen(true);
        }}
        aria-label={openLabel}
        className={`flex h-7 w-7 items-center justify-center rounded-lg bg-black/52 text-white/82 ring-1 ring-white/[0.12] backdrop-blur transition-colors hover:bg-black/72 hover:text-white ${className ?? ''}`}
      >
        <IconArrowsMaximize size={13} stroke={2.2} />
      </button>

      {open ? (
        <dialog
          open
          aria-modal="true"
          aria-label={alt || dialogLabel}
          className="fixed inset-0 z-[70] m-0 flex h-full max-h-none w-full max-w-none items-center justify-center border-0 bg-transparent p-0"
        >
          {/* 遮罩 */}
          <button
            type="button"
            onClick={close}
            aria-label={closeLabel}
            className="absolute inset-0 cursor-zoom-out bg-black/82 backdrop-blur-sm"
          />

          {/* 内容 */}
          <motion.div
            initial={{ opacity: 0, scale: 0.96 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="relative z-10 flex max-h-[92vh] max-w-[92vw] flex-col items-center gap-3"
          >
            <img
              src={src}
              alt={alt}
              className="max-h-[88vh] max-w-[92vw] rounded-[14px] object-contain shadow-[0_30px_80px_rgba(0,0,0,0.6)] ring-1 ring-white/[0.08]"
            />
            {caption ? (
              <div className="max-w-[92vw] truncate text-center text-[12px] text-white/72">
                {caption}
              </div>
            ) : null}
          </motion.div>

          <button
            type="button"
            onClick={close}
            aria-label={closeLabel}
            className="absolute right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-xl bg-black/52 text-white/82 ring-1 ring-white/[0.12] backdrop-blur transition-colors hover:bg-black/72 hover:text-white"
          >
            <IconX size={16} stroke={2.2} />
          </button>
        </dialog>
      ) : null}
    </>
  );
}
