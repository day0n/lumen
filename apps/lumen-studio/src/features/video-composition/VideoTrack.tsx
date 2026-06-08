'use client';

import type { CompositionTimelineClip } from '@lumen/shared/domain';
import { useState } from 'react';

import { TimelineClipBlock } from './TimelineClipBlock';

const PIXELS_PER_SECOND = 56;

export function VideoTrack({
  clips,
  pixelsPerSecond = PIXELS_PER_SECOND,
  selectedClipId,
  onSelectClip,
  onMoveClipToIndex,
  onTrimClipLeft,
  onTrimClipRight,
  resolveClipUrl,
  emptyLabel,
}: {
  clips: CompositionTimelineClip[];
  pixelsPerSecond?: number;
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
  onMoveClipToIndex: (clipId: string, targetIndex: number) => void;
  onTrimClipLeft: (clipId: string, deltaSeconds: number) => void;
  onTrimClipRight: (clipId: string, deltaSeconds: number) => void;
  resolveClipUrl: (clip: CompositionTimelineClip) => string;
  emptyLabel: string;
}) {
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);

  if (clips.length === 0) {
    return (
      <div className="flex h-20 items-center rounded-[8px] bg-[#202124] px-4 text-[12px] font-bold text-white/28 ring-1 ring-white/[0.04]">
        {emptyLabel}
      </div>
    );
  }

  return (
    <div className="py-2">
      <div className="flex min-w-max items-center gap-1.5">
        {clips.map((clip, index) => (
          <TimelineClipBlock
            key={clip.id}
            clip={clip}
            index={index}
            pixelsPerSecond={pixelsPerSecond}
            url={resolveClipUrl(clip)}
            selected={selectedClipId === clip.id}
            dragging={draggingClipId === clip.id}
            onSelect={() => onSelectClip(clip.id)}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', clip.id);
              setDraggingClipId(clip.id);
              onSelectClip(clip.id);
            }}
            onDragEnd={() => setDraggingClipId(null)}
            onDragOver={(event) => {
              event.preventDefault();
              event.dataTransfer.dropEffect = 'move';
            }}
            onDrop={(event) => {
              event.preventDefault();
              const clipId = event.dataTransfer.getData('text/plain') || draggingClipId;
              setDraggingClipId(null);
              if (!clipId || clipId === clip.id) return;
              onMoveClipToIndex(clipId, index);
            }}
            onTrimLeft={(deltaSeconds) => onTrimClipLeft(clip.id, deltaSeconds)}
            onTrimRight={(deltaSeconds) => onTrimClipRight(clip.id, deltaSeconds)}
          />
        ))}
      </div>
    </div>
  );
}
