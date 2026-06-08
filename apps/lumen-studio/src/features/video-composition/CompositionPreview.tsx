'use client';

import { useEffect, useRef } from 'react';

import { resolvePlayheadClip } from './resolvePlayheadClip';
import type { CompositionTimelineClip } from '@lumen/shared/domain';

export function CompositionPreview({
  clips,
  playhead,
  isPlaying,
  bgmUrl,
  bgmVolume,
  resolveClipUrl,
}: {
  clips: CompositionTimelineClip[];
  playhead: number;
  isPlaying: boolean;
  bgmUrl: string | null;
  bgmVolume: number;
  resolveClipUrl: (clip: CompositionTimelineClip) => string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const bgmRef = useRef<HTMLAudioElement>(null);
  const state = resolvePlayheadClip(clips, playhead);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    if (!state) {
      video.pause();
      return;
    }
    const url = resolveClipUrl(state.clip);
    if (!url) {
      video.pause();
      return;
    }

    const targetTime = state.clip.sourceIn + state.localTime;
    if (video.src !== url) {
      video.src = url;
      video.load();
    }

    let cancelled = false;
    const syncPlayback = () => {
      if (cancelled) return;
      if (Math.abs(video.currentTime - targetTime) > (isPlaying ? 0.25 : 0.08)) {
        video.currentTime = targetTime;
      }
      if (isPlaying) {
        void video.play().catch(() => undefined);
      } else {
        video.pause();
      }
    };

    if (video.readyState >= 1) {
      syncPlayback();
    } else {
      video.addEventListener('loadedmetadata', syncPlayback, { once: true });
    }
    return () => {
      cancelled = true;
      video.removeEventListener('loadedmetadata', syncPlayback);
    };
  }, [isPlaying, playhead, resolveClipUrl, state]);

  useEffect(() => {
    const audio = bgmRef.current;
    if (!audio) return;
    if (!bgmUrl) {
      audio.pause();
      return;
    }
    if (audio.src !== bgmUrl) {
      audio.src = bgmUrl;
      audio.load();
    }
    audio.volume = Math.max(0, Math.min(1, bgmVolume));
    if (Math.abs(audio.currentTime - playhead) > (isPlaying ? 0.45 : 0.2)) {
      audio.currentTime = playhead;
    }
    if (isPlaying) {
      void audio.play().catch(() => undefined);
    } else {
      audio.pause();
    }
  }, [bgmUrl, bgmVolume, isPlaying, playhead]);

  return (
    <div className="relative flex h-full w-full items-center justify-center bg-black">
      <video
        ref={videoRef}
        className="max-h-full max-w-full object-contain"
        playsInline
        muted
        preload="metadata"
      >
        <track kind="captions" />
      </video>
      {bgmUrl ? <audio ref={bgmRef} className="hidden" preload="metadata" /> : null}
    </div>
  );
}
