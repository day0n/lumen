'use client';

import type { CompositionTimelineClip } from '@lumen/shared/domain';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';

function resolveDropIndex(pointerX: number, pointerY: number, fallbackIndex: number): number {
  const hit = document
    .elementFromPoint(pointerX, pointerY)
    ?.closest<HTMLElement>('[data-composition-clip-index]');
  const hitIndex = Number(hit?.dataset.compositionClipIndex);
  if (Number.isInteger(hitIndex)) return hitIndex;

  const clips = Array.from(document.querySelectorAll<HTMLElement>('[data-composition-clip-index]'))
    .map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        index: Number(element.dataset.compositionClipIndex),
        left: rect.left,
        right: rect.right,
        center: rect.left + rect.width / 2,
      };
    })
    .filter((item) => Number.isInteger(item.index))
    .sort((a, b) => a.index - b.index);

  if (clips.length === 0) return fallbackIndex;
  const first = clips[0];
  const last = clips[clips.length - 1];
  if (first && pointerX <= first.left) return first.index;
  if (last && pointerX >= last.right) return last.index;

  return clips.reduce((best, item) =>
    Math.abs(item.center - pointerX) < Math.abs(best.center - pointerX) ? item : best,
  ).index;
}

export function TimelineClipBlock({
  clip,
  index,
  pixelsPerSecond,
  url,
  selected,
  onSelect,
  onMoveToIndex,
  onTrimLeft,
  onTrimRight,
}: {
  clip: CompositionTimelineClip;
  index: number;
  pixelsPerSecond: number;
  url: string;
  selected: boolean;
  onSelect: () => void;
  onMoveToIndex: (targetIndex: number) => void;
  onTrimLeft: (deltaSeconds: number) => void;
  onTrimRight: (deltaSeconds: number) => void;
}) {
  const width = Math.max(64, clip.duration * pixelsPerSecond);

  const beginTrim = (side: 'left' | 'right', event: ReactPointerEvent<HTMLSpanElement>) => {
    event.preventDefault();
    event.stopPropagation();

    const startX = event.clientX;
    let appliedDelta = 0;

    const handleMove = (moveEvent: PointerEvent) => {
      moveEvent.preventDefault();
      const nextDelta = (moveEvent.clientX - startX) / pixelsPerSecond;
      const incrementalDelta = nextDelta - appliedDelta;
      appliedDelta = nextDelta;
      if (Math.abs(incrementalDelta) < 0.005) return;
      if (side === 'left') {
        onTrimLeft(incrementalDelta);
      } else {
        onTrimRight(incrementalDelta);
      }
    };

    const handleEnd = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
  };

  const beginReorder = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    if ((event.target as HTMLElement).closest('[data-composition-trim-handle]')) return;

    const element = event.currentTarget;
    const startX = event.clientX;
    const startY = event.clientY;
    let moved = false;

    const cleanup = () => {
      window.removeEventListener('pointermove', handleMove);
      window.removeEventListener('pointerup', handleEnd);
      window.removeEventListener('pointercancel', handleEnd);
      element.style.pointerEvents = '';
      element.style.transform = '';
      element.style.zIndex = '';
      element.style.opacity = '';
    };

    const handleMove = (moveEvent: PointerEvent) => {
      const deltaX = moveEvent.clientX - startX;
      const deltaY = moveEvent.clientY - startY;
      if (!moved && Math.hypot(deltaX, deltaY) < 6) return;
      moved = true;
      moveEvent.preventDefault();
      element.dataset.compositionDragging = 'true';
      element.style.pointerEvents = 'none';
      element.style.transform = `translate3d(${deltaX}px, ${deltaY}px, 0)`;
      element.style.zIndex = '40';
      element.style.opacity = '0.78';
    };

    const handleEnd = (endEvent: PointerEvent) => {
      const wasMoved = moved;
      const targetIndex = wasMoved
        ? resolveDropIndex(endEvent.clientX, endEvent.clientY, index)
        : index;
      cleanup();
      if (!wasMoved) return;
      endEvent.preventDefault();
      element.dataset.compositionWasDragged = 'true';
      window.setTimeout(() => {
        delete element.dataset.compositionWasDragged;
        delete element.dataset.compositionDragging;
      }, 0);
      if (targetIndex !== index) onMoveToIndex(targetIndex);
    };

    window.addEventListener('pointermove', handleMove);
    window.addEventListener('pointerup', handleEnd);
    window.addEventListener('pointercancel', handleEnd);
  };

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect();
  };

  return (
    // biome-ignore lint/a11y/useSemanticElements: timeline clips need custom pointer drag and trim handles.
    <div
      role="button"
      tabIndex={0}
      data-composition-clip-index={index}
      aria-label={`${clip.label ?? 'Clip'} ${index + 1}`}
      className={`group relative h-16 shrink-0 cursor-grab overflow-hidden rounded-[7px] border text-left shadow-[0_10px_24px_rgba(0,0,0,0.22)] transition-colors active:cursor-grabbing ${
        selected
          ? 'border-[#9beaff] bg-[#9beaff]/16 ring-2 ring-[#9beaff]/28'
          : 'border-white/[0.12] bg-[#2a2c31] hover:border-white/[0.24]'
      }`}
      style={{ width }}
      onKeyDown={handleKeyDown}
      onPointerDown={beginReorder}
      onClick={(event) => {
        if (event.currentTarget.dataset.compositionWasDragged === 'true') {
          event.preventDefault();
          return;
        }
        event.stopPropagation();
        onSelect();
      }}
    >
      <span
        aria-hidden="true"
        data-composition-trim-handle="left"
        className="absolute inset-y-1 left-0 z-20 w-3 cursor-ew-resize rounded-r-[4px] bg-white/16 transition-colors group-hover:bg-[#9beaff]/62"
        onPointerDown={(event) => beginTrim('left', event)}
      />
      <span
        aria-hidden="true"
        data-composition-trim-handle="right"
        className="absolute inset-y-1 right-0 z-20 w-3 cursor-ew-resize rounded-l-[4px] bg-white/16 transition-colors group-hover:bg-[#9beaff]/62"
        onPointerDown={(event) => beginTrim('right', event)}
      />
      {url ? (
        <video
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-68"
          muted
          playsInline
          preload="metadata"
          src={url}
        >
          <track kind="captions" />
        </video>
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-r from-black/52 via-black/16 to-black/40" />
      <div className="absolute inset-x-0 bottom-0 h-2 bg-[#00d3c7]/72" />
      <div className="relative flex h-full flex-col justify-between px-3 py-1.5">
        <span className="truncate text-[11px] font-bold text-white/86">
          {clip.label ?? clip.sourceNodeId?.slice(0, 8) ?? 'Clip'}
        </span>
        <span className="w-fit rounded-full bg-black/42 px-1.5 py-0.5 text-[10px] font-bold text-white/68">
          {clip.duration.toFixed(1)}s · in {clip.sourceIn.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}
