'use client';

import { type CompositionTimeline, DEFAULT_COMPOSITION_BGM_VOLUME } from '@lumen/shared/domain';
import {
  IconArrowLeft,
  IconArrowRight,
  IconArrowsMaximize,
  IconDeviceFloppy,
  IconPlayerPause,
  IconPlayerPlay,
  IconScissors,
  IconTrash,
  IconVolume,
  IconX,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { useI18n } from '@/i18n/provider';
import type { CanvasEdgeShape, CanvasNodeShape } from '@/lib/canvas/types';

import { BgmTrack } from './BgmTrack';
import { CompositionPreview } from './CompositionPreview';
import { TimelineRuler } from './TimelineRuler';
import { VideoTrack } from './VideoTrack';
import {
  buildInitialTimeline,
  collectUpstreamBgmUrl,
  collectUpstreamVideoSources,
} from './buildTimelineFromCanvas';
import { probeMediaDurationClient } from './probeMediaDuration';
import { useCompositionTimeline } from './useCompositionTimeline';

const AUTO_DURATION_PLACEHOLDER_SECONDS = 3;

function isAutoDurationPlaceholderClip(clip: CompositionTimeline['clips'][number]): boolean {
  return (
    clip.sourceIn === 0 &&
    Boolean(clip.sourceUrlSnapshot) &&
    Math.abs(clip.duration - AUTO_DURATION_PLACEHOLDER_SECONDS) <= 0.05
  );
}

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
  const hasSavedTimeline = useMemo(() => {
    const raw = settings.timeline;
    if (!raw || typeof raw !== 'object') return false;
    const clips = (raw as { clips?: unknown }).clips;
    return Array.isArray(clips) && clips.length > 0;
  }, [settings]);
  const initialTimeline = useMemo(
    () => buildInitialTimeline(settings, upstreamVideos),
    [settings, upstreamVideos],
  );
  const autoHydrateClipIdsRef = useRef<Set<string> | null>(null);
  const hydratedClipIdsRef = useRef<Set<string>>(new Set());

  if (autoHydrateClipIdsRef.current === null) {
    autoHydrateClipIdsRef.current = hasSavedTimeline
      ? new Set()
      : new Set(initialTimeline.clips.filter(isAutoDurationPlaceholderClip).map((clip) => clip.id));
  }

  const {
    timeline,
    setTimeline,
    sortedClips,
    totalDuration,
    playhead,
    setPlayhead,
    selectedClipId,
    setSelectedClipId,
    updateTimeline,
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
  const [timelineZoom, setTimelineZoom] = useState(74);

  const shouldHydrateClipDuration = useCallback((clip: CompositionTimeline['clips'][number]) => {
    return (
      Boolean(autoHydrateClipIdsRef.current?.has(clip.id)) &&
      !hydratedClipIdsRef.current.has(clip.id) &&
      isAutoDurationPlaceholderClip(clip)
    );
  }, []);

  const hydrateClipDuration = useCallback(
    (clipId: string, duration: number) => {
      setTimeline((current) => {
        const clip = current.clips.find((item) => item.id === clipId);
        if (!clip || !shouldHydrateClipDuration(clip)) return current;

        hydratedClipIdsRef.current.add(clipId);
        if (Math.abs(clip.duration - duration) <= 0.05) return current;

        return {
          ...current,
          clips: current.clips.map((item) => (item.id === clipId ? { ...item, duration } : item)),
        };
      });
    },
    [setTimeline, shouldHydrateClipDuration],
  );

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
      if (!shouldHydrateClipDuration(clip)) continue;
      if (known) {
        hydrateClipDuration(clip.id, known);
        continue;
      }
      void probeMediaDurationClient(url, projectId).then((duration) => {
        if (!duration) return;
        setSourceDurationByUrl((current) => new Map(current).set(url, duration));
        hydrateClipDuration(clip.id, duration);
      });
    }
  }, [hydrateClipDuration, projectId, shouldHydrateClipDuration, sortedClips, sourceDurationByUrl]);

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
  const rulerDuration = Math.max(totalDuration, 13);
  const timelineWidth = Math.max(980, Math.ceil(rulerDuration * timelineZoom));
  const playheadLeft = `${(Math.min(playhead, rulerDuration) / rulerDuration) * 100}%`;

  const handleSave = () => {
    onSave(timeline);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[120] flex flex-col bg-[#101112] text-white">
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-white/[0.06] bg-[#111214] px-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-bold">{t('canvas.composition.title')}</div>
        </div>
        <button
          type="button"
          className="flex h-8 items-center gap-1.5 rounded-[9px] bg-white/[0.08] px-3 text-[12px] font-bold text-white/78 ring-1 ring-white/[0.08] hover:bg-white/[0.12]"
          onClick={handleSave}
        >
          <IconDeviceFloppy size={14} />
          {t('canvas.composition.save')}
        </button>
        <button
          type="button"
          disabled={!canRun || isRunning}
          className="flex h-8 items-center gap-1.5 rounded-[9px] bg-white px-3 text-[12px] font-black text-[#111315] disabled:cursor-not-allowed disabled:opacity-45"
          onClick={() => {
            onRun(timeline);
          }}
        >
          {isRunning ? t('canvas.node.running') : t('canvas.composition.render')}
        </button>
        <button
          type="button"
          aria-label={t('common.close')}
          className="flex h-8 w-8 items-center justify-center rounded-[9px] bg-white/[0.06] text-white/72 ring-1 ring-white/[0.08] hover:bg-white/[0.1]"
          onClick={onClose}
        >
          <IconX size={18} />
        </button>
      </header>

      <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_292px]">
        <CompositionPreview
          clips={sortedClips}
          playhead={playhead}
          isPlaying={isPlaying}
          bgmUrl={bgmUrl}
          bgmVolume={timeline.bgmVolume ?? DEFAULT_COMPOSITION_BGM_VOLUME}
          resolveClipUrl={resolveClipUrl}
        />

        <div className="flex min-h-0 flex-col border-t border-white/[0.08] bg-[#17181b] shadow-[0_-24px_80px_rgba(0,0,0,0.42)]">
          <div className="flex h-11 shrink-0 items-center gap-2 border-b border-white/[0.06] px-3">
            <button
              type="button"
              disabled={!selectedClip}
              title={t('canvas.composition.split')}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/[0.07] text-white/68 ring-1 ring-white/[0.06] hover:bg-white/[0.12] disabled:opacity-30"
              onClick={() => splitClipAtPlayhead(sourceDurationByUrl)}
            >
              <IconScissors size={15} />
            </button>
            <button
              type="button"
              disabled={!selectedClip}
              title={t('canvas.composition.delete')}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/[0.07] text-white/68 ring-1 ring-white/[0.06] hover:bg-white/[0.12] disabled:opacity-30"
              onClick={() => selectedClip && deleteClip(selectedClip.id)}
            >
              <IconTrash size={15} />
            </button>
            <button
              type="button"
              disabled={!selectedClip}
              title={t('canvas.composition.moveLeft')}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/[0.07] text-white/68 ring-1 ring-white/[0.06] hover:bg-white/[0.12] disabled:opacity-30"
              onClick={() => selectedClip && moveClip(selectedClip.id, -1)}
            >
              <IconArrowLeft size={15} />
            </button>
            <button
              type="button"
              disabled={!selectedClip}
              title={t('canvas.composition.moveRight')}
              className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/[0.07] text-white/68 ring-1 ring-white/[0.06] hover:bg-white/[0.12] disabled:opacity-30"
              onClick={() => selectedClip && moveClip(selectedClip.id, 1)}
            >
              <IconArrowRight size={15} />
            </button>
            <div className="ml-auto flex items-center gap-2">
              <span className="min-w-[42px] text-right text-[12px] font-bold text-white/58">
                {formatCompositionTime(playhead)}
              </span>
              <button
                type="button"
                className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-[#111315] shadow-[0_10px_28px_rgba(0,0,0,0.32)]"
                onClick={() => setIsPlaying((current) => !current)}
              >
                {isPlaying ? <IconPlayerPause size={17} /> : <IconPlayerPlay size={17} />}
              </button>
              <span className="min-w-[42px] text-[12px] font-bold text-white/58">
                {formatCompositionTime(totalDuration)}
              </span>
            </div>
            <div className="ml-auto flex items-center gap-2 text-white/52">
              <IconVolume size={15} />
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={timeline.bgmVolume ?? DEFAULT_COMPOSITION_BGM_VOLUME}
                className="w-20 accent-white"
                onChange={(event) => updateTimeline({ bgmVolume: Number(event.target.value) })}
              />
              <IconZoomOut size={15} />
              <input
                type="range"
                min={48}
                max={120}
                step={2}
                value={timelineZoom}
                className="w-24 accent-white"
                onChange={(event) => setTimelineZoom(Number(event.target.value))}
              />
              <IconZoomIn size={15} />
              <button
                type="button"
                title={t('common.fullscreen')}
                className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/[0.07] text-white/68 ring-1 ring-white/[0.06] hover:bg-white/[0.12]"
                onClick={() => document.documentElement.requestFullscreen?.()}
              >
                <IconArrowsMaximize size={15} />
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-x-auto px-4 pb-4 pt-2">
            <div className="relative" style={{ width: timelineWidth }}>
              <TimelineRuler
                duration={rulerDuration}
                playhead={playhead}
                onSeek={(seconds) => setPlayhead(Math.min(totalDuration, seconds))}
              />
              <span
                className="pointer-events-none absolute bottom-0 top-0 z-30 w-px bg-white/76 shadow-[0_0_0_1px_rgba(0,0,0,0.24)]"
                style={{ left: playheadLeft }}
              >
                <span className="absolute -left-[5px] top-0 h-3 w-3 rounded-sm bg-white" />
              </span>
              <div className="grid grid-cols-[64px_1fr] gap-2 pt-2">
                <div className="flex h-20 items-center gap-2 text-white/44">
                  <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-white/[0.06] ring-1 ring-white/[0.06]">
                    <IconPlayerPlay size={14} />
                  </span>
                  <span className="text-[11px] font-bold">V</span>
                </div>
                <VideoTrack
                  clips={sortedClips}
                  pixelsPerSecond={timelineZoom}
                  selectedClipId={selectedClipId}
                  onSelectClip={setSelectedClipId}
                  onMoveClipToIndex={moveClipToIndex}
                  onTrimClipLeft={trimClipLeft}
                  onTrimClipRight={trimClipRightByDelta}
                  resolveClipUrl={resolveClipUrl}
                  emptyLabel={t('canvas.composition.emptyTrack')}
                />
              </div>
              <div className="grid grid-cols-[64px_1fr] gap-2">
                <div className="flex h-10 items-center gap-2 text-white/44">
                  <span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-white/[0.06] ring-1 ring-white/[0.06]">
                    <IconVolume size={14} />
                  </span>
                  <span className="text-[11px] font-bold">A</span>
                </div>
                <BgmTrack
                  bgmUrl={bgmUrl}
                  volume={timeline.bgmVolume ?? DEFAULT_COMPOSITION_BGM_VOLUME}
                />
              </div>
            </div>
          </div>

          <div className="flex h-10 shrink-0 items-center gap-3 border-t border-white/[0.06] px-3 text-[11px] text-white/42">
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
            {selectedClip ? (
              <div className="ml-auto flex items-center gap-2">
                <label className="flex items-center gap-1">
                  {t('canvas.composition.trimIn')}
                  <input
                    type="number"
                    min={0}
                    step={0.1}
                    value={Number(selectedClip.sourceIn.toFixed(2))}
                    className="w-16 rounded-[6px] bg-[#242529] px-1 py-0.5 text-white"
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
                    className="w-16 rounded-[6px] bg-[#242529] px-1 py-0.5 text-white"
                    onChange={(event) => {
                      const next = Number(event.target.value);
                      if (!Number.isFinite(next)) return;
                      trimClipRight(selectedClip.id, next);
                    }}
                  />
                </label>
              </div>
            ) : null}
            <span className={selectedClip ? '' : 'ml-auto'}>{totalDuration.toFixed(1)}s</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatCompositionTime(seconds: number) {
  const whole = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(whole / 60);
  const remainingSeconds = whole % 60;
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
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
