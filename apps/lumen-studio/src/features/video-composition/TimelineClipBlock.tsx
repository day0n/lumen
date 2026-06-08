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
  const width = Math.max(48, clip.duration * pixelsPerSecond);

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
      className={`group relative h-14 shrink-0 cursor-grab overflow-hidden rounded-[8px] border text-left transition-colors active:cursor-grabbing ${
        selected
          ? 'border-[#9beaff]/72 bg-[#9beaff]/16 ring-1 ring-[#9beaff]/28'
          : 'border-white/[0.1] bg-[#2a2c31] hover:border-white/[0.18]'
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
        className="absolute inset-y-0 left-0 z-20 w-3 cursor-ew-resize bg-[#9beaff]/0 transition-colors group-hover:bg-[#9beaff]/22"
        onPointerDown={(event) => beginTrim('left', event)}
      />
      <span
        aria-hidden="true"
        className="absolute inset-y-0 right-0 z-20 w-3 cursor-ew-resize bg-[#9beaff]/0 transition-colors group-hover:bg-[#9beaff]/22"
        onPointerDown={(event) => beginTrim('right', event)}
      />
      <div className="absolute inset-0 bg-gradient-to-br from-[#d7b0ff]/18 to-transparent" />
      <div className="relative flex h-full flex-col justify-between px-2 py-1.5">
        <span className="truncate text-[11px] font-bold text-white/86">
          {clip.label ?? clip.sourceNodeId?.slice(0, 8) ?? 'Clip'}
        </span>
        <span className="text-[10px] text-white/42">
          {clip.duration.toFixed(1)}s · in {clip.sourceIn.toFixed(1)}s
        </span>
      </div>
    </div>
  );
}
