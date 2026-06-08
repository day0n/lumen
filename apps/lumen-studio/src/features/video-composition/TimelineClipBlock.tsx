'use client';

import type { CompositionTimelineClip } from '@lumen/shared/domain';
import type {
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from 'react';

export function TimelineClipBlock({
  clip,
  index,
  pixelsPerSecond,
  url,
  selected,
  dragging,
  onSelect,
  onDragStart,
  onDragEnd,
  onDragOver,
  onDrop,
  onTrimLeft,
  onTrimRight,
}: {
  clip: CompositionTimelineClip;
  index: number;
  pixelsPerSecond: number;
  url: string;
  selected: boolean;
  dragging: boolean;
  onSelect: () => void;
  onDragStart: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDragEnd: () => void;
  onDragOver: (event: ReactDragEvent<HTMLDivElement>) => void;
  onDrop: (event: ReactDragEvent<HTMLDivElement>) => void;
  onTrimLeft: (deltaSeconds: number) => void;
  onTrimRight: (deltaSeconds: number) => void;
}) {
  const width = Math.max(64, clip.duration * pixelsPerSecond);

  const beginTrim = (
    side: 'left' | 'right',
    event: ReactPointerEvent<HTMLSpanElement>,
  ) => {
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

  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onSelect();
  };

  return (
    <div
      role="button"
      tabIndex={0}
      draggable
      aria-label={`${clip.label ?? 'Clip'} ${index + 1}`}
      className={`group relative h-16 shrink-0 cursor-grab overflow-hidden rounded-[7px] border text-left shadow-[0_10px_24px_rgba(0,0,0,0.22)] transition-colors active:cursor-grabbing ${
        selected
          ? 'border-[#9beaff] bg-[#9beaff]/16 ring-2 ring-[#9beaff]/28'
          : 'border-white/[0.12] bg-[#2a2c31] hover:border-white/[0.24]'
      } ${dragging ? 'opacity-45' : ''}`}
      style={{ width }}
      onKeyDown={handleKeyDown}
      onClick={(event) => {
        event.stopPropagation();
        onSelect();
      }}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={onDragOver}
      onDrop={onDrop}
    >
      <span
        aria-hidden="true"
        className="absolute inset-y-1 left-0 z-20 w-3 cursor-ew-resize rounded-r-[4px] bg-white/16 transition-colors group-hover:bg-[#9beaff]/62"
        onPointerDown={(event) => beginTrim('left', event)}
      />
      <span
        aria-hidden="true"
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
