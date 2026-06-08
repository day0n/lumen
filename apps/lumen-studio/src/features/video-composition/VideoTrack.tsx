'use client';

import type { CompositionTimelineClip } from '@lumen/shared/domain';
import { useState } from 'react';

import { TimelineClipBlock } from './TimelineClipBlock';

const PIXELS_PER_SECOND = 56;

export function VideoTrack({
  clips,
  selectedClipId,
  onSelectClip,
  onMoveClipToIndex,
  onTrimClipLeft,
  onTrimClipRight,
}: {
  clips: CompositionTimelineClip[];
  selectedClipId: string | null;
  onSelectClip: (clipId: string) => void;
  onMoveClipToIndex: (clipId: string, targetIndex: number) => void;
  onTrimClipLeft: (clipId: string, deltaSeconds: number) => void;
  onTrimClipRight: (clipId: string, deltaSeconds: number) => void;
}) {
  const [draggingClipId, setDraggingClipId] = useState<string | null>(null);

  return (
    <div className="overflow-x-auto px-3 py-2">
      <div className="flex min-w-max items-center gap-2">
        {clips.map((clip, index) => (
          <TimelineClipBlock
            key={clip.id}
            clip={clip}
            index={index}
            pixelsPerSecond={PIXELS_PER_SECOND}
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
