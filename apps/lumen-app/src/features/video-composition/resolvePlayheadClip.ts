import type { CompositionTimelineClip } from '@lumen/shared/domain';

export interface PlayheadClipState {
  clip: CompositionTimelineClip;
  clipIndex: number;
  timelineOffset: number;
  localTime: number;
}

export function resolvePlayheadClip(
  clips: CompositionTimelineClip[],
  playheadSeconds: number,
): PlayheadClipState | null {
  const sorted = [...clips].sort((a, b) => a.order - b.order);
  let offset = 0;

  for (let index = 0; index < sorted.length; index += 1) {
    const clip = sorted[index];
    if (!clip) continue;
    const end = offset + clip.duration;
    if (playheadSeconds >= offset && playheadSeconds < end) {
      return {
        clip,
        clipIndex: index,
        timelineOffset: offset,
        localTime: playheadSeconds - offset,
      };
    }
    offset = end;
  }

  const last = sorted.at(-1);
  if (last && playheadSeconds >= offset) {
    return {
      clip: last,
      clipIndex: sorted.length - 1,
      timelineOffset: offset - last.duration,
      localTime: last.duration,
    };
  }

  return null;
}

export function getTimelineDuration(clips: CompositionTimelineClip[]): number {
  return clips.reduce((total, clip) => total + clip.duration, 0);
}
