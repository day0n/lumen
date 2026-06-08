'use client';

import type { CompositionTimeline, CompositionTimelineClip } from '@lumen/shared/domain';
import { nanoid } from 'nanoid';
import { useCallback, useMemo, useState } from 'react';

import { getTimelineDuration } from './resolvePlayheadClip';

function normalizeOrders(clips: CompositionTimelineClip[]): CompositionTimelineClip[] {
  return clips
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((clip, index) => ({ ...clip, order: index }));
}

export function useCompositionTimeline(initial: CompositionTimeline) {
  const [timeline, setTimeline] = useState<CompositionTimeline>(initial);
  const [playhead, setPlayhead] = useState(0);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(initial.clips[0]?.id ?? null);

  const sortedClips = useMemo(
    () => [...timeline.clips].sort((a, b) => a.order - b.order),
    [timeline.clips],
  );
  const totalDuration = useMemo(() => getTimelineDuration(sortedClips), [sortedClips]);

  const updateTimeline = useCallback((patch: Partial<CompositionTimeline>) => {
    setTimeline((current) => ({ ...current, ...patch }));
  }, []);

  const updateClip = useCallback((clipId: string, patch: Partial<CompositionTimelineClip>) => {
    setTimeline((current) => ({
      ...current,
      clips: normalizeOrders(
        current.clips.map((clip) => (clip.id === clipId ? { ...clip, ...patch } : clip)),
      ),
    }));
  }, []);

  const deleteClip = useCallback((clipId: string) => {
    setTimeline((current) => ({
      ...current,
      clips: normalizeOrders(current.clips.filter((clip) => clip.id !== clipId)),
    }));
    setSelectedClipId((current) => (current === clipId ? null : current));
  }, []);

  const moveClip = useCallback((clipId: string, direction: -1 | 1) => {
    setTimeline((current) => {
      const ordered = normalizeOrders(current.clips);
      const index = ordered.findIndex((clip) => clip.id === clipId);
      if (index < 0) return current;
      const target = index + direction;
      if (target < 0 || target >= ordered.length) return current;
      const next = ordered.slice();
      const [item] = next.splice(index, 1);
      if (!item) return current;
      next.splice(target, 0, item);
      return { ...current, clips: normalizeOrders(next) };
    });
  }, []);

  const moveClipToIndex = useCallback((clipId: string, targetIndex: number) => {
    setTimeline((current) => {
      const ordered = normalizeOrders(current.clips);
      const index = ordered.findIndex((clip) => clip.id === clipId);
      if (index < 0) return current;
      const clampedTarget = Math.max(0, Math.min(targetIndex, ordered.length - 1));
      if (clampedTarget === index) return current;
      const next = ordered.slice();
      const [item] = next.splice(index, 1);
      if (!item) return current;
      next.splice(clampedTarget, 0, item);
      return { ...current, clips: normalizeOrders(next) };
    });
  }, []);

  const splitClipAtPlayhead = useCallback(
    (sourceDurationByUrl: Map<string, number>) => {
      const ordered = sortedClips;
      let offset = 0;
      for (const clip of ordered) {
        const end = offset + clip.duration;
        if (playhead > offset && playhead < end) {
          const local = playhead - offset;
          const minSegment = 0.25;
          if (local < minSegment || clip.duration - local < minSegment) return;

          const sourceUrl = clip.sourceUrlSnapshot ?? '';
          const maxSource = sourceDurationByUrl.get(sourceUrl) ?? clip.sourceIn + clip.duration;

          const firstDuration = local;
          const secondDuration = clip.duration - local;
          const secondSourceIn = clip.sourceIn + local;

          if (secondSourceIn + secondDuration > maxSource + 0.01) return;

          const firstId = nanoid(10);
          const secondId = nanoid(10);
          setTimeline((current) => ({
            ...current,
            clips: normalizeOrders(
              current.clips.flatMap((item) => {
                if (item.id !== clip.id) return [item];
                return [
                  { ...item, id: firstId, duration: firstDuration },
                  {
                    ...item,
                    id: secondId,
                    sourceIn: secondSourceIn,
                    duration: secondDuration,
                  },
                ];
              }),
            ),
          }));
          setSelectedClipId(secondId);
          return;
        }
        offset = end;
      }
    },
    [playhead, sortedClips],
  );

  const trimClipLeft = useCallback((clipId: string, deltaSeconds: number) => {
    setTimeline((current) => ({
      ...current,
      clips: normalizeOrders(
        current.clips.map((clip) => {
          if (clip.id !== clipId) return clip;
          const maxPositiveDelta = Math.max(0, clip.duration - 0.25);
          const appliedDelta = Math.max(-clip.sourceIn, Math.min(deltaSeconds, maxPositiveDelta));
          const nextSourceIn = clip.sourceIn + appliedDelta;
          const nextDuration = clip.duration - appliedDelta;
          return { ...clip, sourceIn: nextSourceIn, duration: nextDuration };
        }),
      ),
    }));
  }, []);

  const trimClipRight = useCallback((clipId: string, nextDuration: number) => {
    setTimeline((current) => ({
      ...current,
      clips: normalizeOrders(
        current.clips.map((clip) =>
          clip.id === clipId ? { ...clip, duration: Math.max(0.25, nextDuration) } : clip,
        ),
      ),
    }));
  }, []);

  const trimClipRightByDelta = useCallback((clipId: string, deltaSeconds: number) => {
    setTimeline((current) => ({
      ...current,
      clips: normalizeOrders(
        current.clips.map((clip) =>
          clip.id === clipId
            ? { ...clip, duration: Math.max(0.25, clip.duration + deltaSeconds) }
            : clip,
        ),
      ),
    }));
  }, []);

  return {
    timeline,
    setTimeline,
    sortedClips,
    totalDuration,
    playhead,
    setPlayhead,
    selectedClipId,
    setSelectedClipId,
    updateTimeline,
    updateClip,
    deleteClip,
    moveClip,
    moveClipToIndex,
    splitClipAtPlayhead,
    trimClipLeft,
    trimClipRight,
    trimClipRightByDelta,
  };
}
