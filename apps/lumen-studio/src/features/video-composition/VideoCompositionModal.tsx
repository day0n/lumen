'use client';

import type { CompositionTimeline } from '@lumen/shared/domain';
import {
  IconArrowLeft,
  IconArrowRight,
  IconPlayerPlay,
  IconScissors,
  IconTrash,
  IconX,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useI18n } from '@/i18n/provider';
import type { CanvasEdgeShape, CanvasNodeShape } from '@/lib/canvas/types';

import { BgmTrack } from './BgmTrack';
import {
  buildInitialTimeline,
  collectUpstreamBgmUrl,
  collectUpstreamVideoSources,
} from './buildTimelineFromCanvas';
import { CompositionPreview } from './CompositionPreview';
import { probeMediaDurationClient } from './probeMediaDuration';
import { TimelineRuler } from './TimelineRuler';
import { useCompositionTimeline } from './useCompositionTimeline';
import { VideoTrack } from './VideoTrack';

export function VideoCompositionModal({
  nodeId,
  nodes,
  edges,
  settings,
  projectId,
  onClose,
  onSave,
  onRun,
  canRun,
  isRunning,
}: {
  nodeId: string;
  nodes: CanvasNodeShape[];
  edges: CanvasEdgeShape[];
  settings: Record<string, unknown>;
  projectId?: string | null;
  onClose: () => void;
  onSave: (timeline: CompositionTimeline) => void;
  onRun: (timeline: CompositionTimeline) => void;
  canRun: boolean;
  isRunning: boolean;
}) {
  const { t } = useI18n();
  const upstreamVideos = useMemo(
    () => collectUpstreamVideoSources(nodeId, nodes, edges),
    [edges, nodeId, nodes],
  );
  const bgmUrl = useMemo(() => collectUpstreamBgmUrl(nodeId, nodes, edges), [edges, nodeId, nodes]);
  const initialTimeline = useMemo(
    () => buildInitialTimeline(settings, upstreamVideos),
    [settings, upstreamVideos],
  );

  const {
    timeline,
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
  } = useCompositionTimeline(initialTimeline);

  const [sourceDurationByUrl, setSourceDurationByUrl] = useState<Map<string, number>>(new Map());
  const [isPlaying, setIsPlaying] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const urls = new Set<string>();
    for (const source of upstreamVideos) urls.add(source.url);
    for (const clip of sortedClips) {
      if (clip.sourceUrlSnapshot) urls.add(clip.sourceUrlSnapshot);
    }

    void (async () => {
      const next = new Map<string, number>();
      for (const url of urls) {
        const duration = await probeMediaDurationClient(url, projectId);
        if (cancelled || !duration) continue;
        next.set(url, duration);
      }
      if (!cancelled) setSourceDurationByUrl(next);
    })();

    return () => {
      cancelled = true;
    };
  }, [projectId, sortedClips, upstreamVideos]);

  useEffect(() => {
    for (const clip of sortedClips) {
      const url = clip.sourceUrlSnapshot;
      const known = url ? sourceDurationByUrl.get(url) : undefined;
      if (!url) continue;
      if (known && clip.duration <= 3.01 && clip.sourceIn === 0) {
        if (Math.abs(clip.duration - known) > 0.05) {
          updateClip(clip.id, { duration: known });
        }
        continue;
      }
      if (!known && clip.duration <= 3.01 && clip.sourceIn === 0) {
        void probeMediaDurationClient(url, projectId).then((duration) => {
          if (!duration) return;
          setSourceDurationByUrl((current) => new Map(current).set(url, duration));
          updateClip(clip.id, { duration });
        });
      }
    }
  }, [projectId, sortedClips, sourceDurationByUrl, updateClip]);

  useEffect(() => {
    if (!isPlaying) return;
    const timer = window.setInterval(() => {
      setPlayhead((current) => {
        const next = current + 0.1;
        if (next >= totalDuration) {
          setIsPlaying(false);
          return totalDuration;
        }
        return next;
      });
    }, 100);
    return () => window.clearInterval(timer);
  }, [isPlaying, setPlayhead, totalDuration]);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  const resolveClipUrl = useCallback(
    (clip: (typeof sortedClips)[number]) => {
      if (clip.sourceNodeId) {
        const node = nodes.find((item) => item.id === clip.sourceNodeId);
        const output = node?.data.output?.trim();
        if (output && !output.startsWith('blob:')) return output;
      }
      return clip.sourceUrlSnapshot ?? '';
    },
    [nodes],
  );

  const selectedClip = sortedClips.find((clip) => clip.id === selectedClipId) ?? null;

  const handleSave = () => {
    onSave(timeline);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-[#0b0c0e] text-white">
      <header className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3">
        <button
          type="button"
          aria-label={t('common.close')}
          className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-white/72 ring-1 ring-white/[0.08] hover:bg-white/[0.1]"
          onClick={onClose}
        >
          <IconX size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-bold">{t('canvas.composition.title')}</div>
          <div className="text-[12px] text-white/42">{t('canvas.composition.subtitle')}</div>
        </div>
        <button
          type="button"
          className="rounded-[10px] bg-white/[0.08] px-3 py-2 text-[12px] font-bold text-white/78 ring-1 ring-white/[0.08] hover:bg-white/[0.12]"
          onClick={handleSave}
        >
          {t('canvas.composition.save')}
        </button>
        <button
          type="button"
          disabled={!canRun || isRunning}
          className="rounded-[10px] bg-[#9beaff] px-3 py-2 text-[12px] font-black text-[#041015] disabled:cursor-not-allowed disabled:opacity-45"
          onClick={() => {
            onRun(timeline);
          }}
        >
          {isRunning ? t('canvas.node.running') : t('canvas.composition.render')}
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_280px]">
        <CompositionPreview
          clips={sortedClips}
          playhead={playhead}
          isPlaying={isPlaying}
          bgmUrl={bgmUrl}
          bgmVolume={timeline.bgmVolume ?? 0.8}
          resolveClipUrl={resolveClipUrl}
        />

        <div className="flex min-h-0 flex-col border-t border-white/[0.08] bg-[#121316]">
          <TimelineRuler duration={totalDuration} playhead={playhead} onSeek={setPlayhead} />
          <div className="flex items-center gap-2 border-b border-white/[0.06] px-3 py-2">
            <button
              type="button"
              className="flex h-8 items-center gap-1 rounded-[8px] bg-white/[0.08] px-2 text-[11px] font-bold"
              onClick={() => setIsPlaying((current) => !current)}
            >
              <IconPlayerPlay size={14} />
              {isPlaying ? t('canvas.composition.pause') : t('canvas.composition.play')}
            </button>
            <button
              type="button"
              disabled={!selectedClip}
              className="flex h-8 items-center gap-1 rounded-[8px] bg-white/[0.08] px-2 text-[11px] font-bold disabled:opacity-35"
              onClick={() => splitClipAtPlayhead(sourceDurationByUrl)}
            >
              <IconScissors size={14} />
              {t('canvas.composition.split')}
            </button>
            <button
              type="button"
              disabled={!selectedClip}
              className="flex h-8 items-center gap-1 rounded-[8px] bg-white/[0.08] px-2 text-[11px] font-bold disabled:opacity-35"
              onClick={() => selectedClip && deleteClip(selectedClip.id)}
            >
              <IconTrash size={14} />
              {t('canvas.composition.delete')}
            </button>
            <button
              type="button"
              disabled={!selectedClip}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/[0.08] disabled:opacity-35"
              onClick={() => selectedClip && moveClip(selectedClip.id, -1)}
            >
              <IconArrowLeft size={14} />
            </button>
            <button
              type="button"
              disabled={!selectedClip}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/[0.08] disabled:opacity-35"
              onClick={() => selectedClip && moveClip(selectedClip.id, 1)}
            >
              <IconArrowRight size={14} />
            </button>
            {selectedClip ? (
              <div className="ml-auto flex items-center gap-2 text-[11px] text-white/52">
                <label className="flex items-center gap-1">
                  {t('canvas.composition.trimIn')}
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={Number(selectedClip.sourceIn.toFixed(2))}
                    className="w-16 rounded-[6px] bg-[#1c1d20] px-1 py-0.5 text-white"
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (!Number.isFinite(next)) return;
                      const delta = next - selectedClip.sourceIn;
                      trimClipLeft(selectedClip.id, delta);
                    }}
                  />
                </label>
                <label className="flex items-center gap-1">
                  {t('canvas.composition.duration')}
                  <input
                    type="number"
                    min={0.25}
                    step={0.1}
                    value={Number(selectedClip.duration.toFixed(2))}
                    className="w-16 rounded-[6px] bg-[#1c1d20] px-1 py-0.5 text-white"
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (!Number.isFinite(next)) return;
                      trimClipRight(selectedClip.id, next);
                    }}
                  />
                </label>
              </div>
            ) : null}
          </div>
          <BgmTrack bgmUrl={bgmUrl} volume={timeline.bgmVolume ?? 0.8} />
          <VideoTrack
            clips={sortedClips}
            selectedClipId={selectedClipId}
            onSelectClip={setSelectedClipId}
            onMoveClipToIndex={moveClipToIndex}
            onTrimClipLeft={trimClipLeft}
            onTrimClipRight={trimClipRightByDelta}
          />
          <div className="flex items-center gap-3 border-t border-white/[0.06] px-3 py-2 text-[11px] text-white/42">
            <ParamSelect
              label={t('canvas.node.ratio')}
              value={timeline.aspectRatio}
              options={['9:16', '16:9', '1:1', '4:5']}
              onChange={(value) =>
                updateTimeline({ aspectRatio: value as CompositionTimeline['aspectRatio'] })
              }
            />
            <ParamSelect
              label={t('canvas.node.resolution')}
              value={timeline.resolution}
              options={['720p', '1080p']}
              onChange={(value) =>
                updateTimeline({ resolution: value as CompositionTimeline['resolution'] })
              }
            />
            <label className="flex items-center gap-1">
              BGM
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={timeline.bgmVolume ?? 0.8}
                onChange={(event) =>
                  updateTimeline({ bgmVolume: Number(event.target.value) })
                }
              />
            </label>
            <span className="ml-auto">{totalDuration.toFixed(1)}s</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function ParamSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <label className="flex items-center gap-1">
      {label}
      <select
        value={value}
        className="rounded-[6px] bg-[#1c1d20] px-1 py-0.5 text-white"
        onChange={(event) => onChange(event.target.value)}
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
