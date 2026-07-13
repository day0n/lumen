'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { MicrophoneIcon, MicrophoneOffIcon, TrashIcon } from '../../features/home/home-icons';
import { cn } from '../../lib/cn';

const BAR_COUNT = 14;
const DELETE_STAGGER = 0.022;
const DELETE_DURATION = 0.26;
const PANEL_TRANSITION_MS = 280;

function useWaveformHeights(active: boolean) {
  const [heights, setHeights] = useState<number[]>(() =>
    Array.from({ length: BAR_COUNT }, () => 0.35),
  );

  useEffect(() => {
    if (!active) return;
    let frame = 0;
    const tick = () => {
      frame += 1;
      setHeights(
        Array.from({ length: BAR_COUNT }, (_, index) => {
          const wave = Math.sin(frame * 0.14 + index * 0.65);
          const wave2 = Math.cos(frame * 0.09 + index * 0.4);
          return 0.22 + Math.abs(wave * 0.38 + wave2 * 0.22);
        }),
      );
    };
    tick();
    const id = window.setInterval(tick, 90);
    return () => window.clearInterval(id);
  }, [active]);

  return heights;
}

function VoiceWaveform({
  deleting,
  listening,
  reducedMotion,
}: {
  deleting: boolean;
  listening: boolean;
  reducedMotion: boolean;
}) {
  const heights = useWaveformHeights(listening && !deleting && !reducedMotion);
  const seeds = useMemo(
    () =>
      Array.from({ length: BAR_COUNT }, (_, index) => ({
        id: `voice-bar-${index + 1}`,
        height: 0.28 + (index % 5) * 0.08,
      })),
    [],
  );

  return (
    <div className="flex h-7 min-w-[132px] flex-1 items-center justify-center gap-[3px] px-1">
      {seeds.map((seed, index) => (
        <span
          key={seed.id}
          className="voice-input-waveform-bar w-[3px] origin-bottom rounded-full bg-gradient-to-t from-[#ff5fbf] to-[#ff8ecf]"
          style={{
            height: 22 * seed.height,
            opacity: deleting ? 0 : 1,
            transform: `scaleY(${deleting ? 0 : listening && !reducedMotion ? (heights[index] ?? seed.height) : seed.height})`,
            transitionDelay: !reducedMotion && deleting ? `${index * DELETE_STAGGER}s` : '0s',
            transitionDuration: reducedMotion ? '0s' : deleting ? `${DELETE_DURATION}s` : '0.12s',
            transitionTimingFunction: deleting
              ? 'cubic-bezier(0.32, 0.72, 0, 1)'
              : 'cubic-bezier(0.22, 1, 0.36, 1)',
          }}
        />
      ))}
    </div>
  );
}

export function VoiceInputControl({
  listening,
  supported,
  error,
  disabled = false,
  variant = 'composer',
  labels,
  onToggle,
  onCancel,
}: {
  listening: boolean;
  supported: boolean;
  error?: string | null;
  disabled?: boolean;
  variant?: 'hero' | 'composer';
  labels: {
    voiceInput: string;
    voiceStop: string;
    voiceUnsupported: string;
    voiceCancel: string;
  };
  onToggle: () => void;
  onCancel: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [panelOpen, setPanelOpen] = useState(false);
  const [panelMounted, setPanelMounted] = useState(false);
  const [panelEntered, setPanelEntered] = useState(false);
  const [panelExiting, setPanelExiting] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(false);
  const deleteTimeoutRef = useRef<number | null>(null);
  const panelExitTimeoutRef = useRef<number | null>(null);
  const panelFrameRef = useRef<number | null>(null);
  const panelMountedRef = useRef(false);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setReducedMotion(media.matches);
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    if (listening) setPanelOpen(true);
    else if (!deleting) setPanelOpen(false);
  }, [listening, deleting]);

  useEffect(() => {
    if (panelExitTimeoutRef.current !== null) {
      window.clearTimeout(panelExitTimeoutRef.current);
      panelExitTimeoutRef.current = null;
    }
    if (panelFrameRef.current !== null) {
      window.cancelAnimationFrame(panelFrameRef.current);
      panelFrameRef.current = null;
    }

    if (panelOpen) {
      const wasMounted = panelMountedRef.current;
      panelMountedRef.current = true;
      setPanelMounted(true);
      setPanelExiting(false);

      if (wasMounted || reducedMotion) {
        setPanelEntered(true);
      } else {
        setPanelEntered(false);
        panelFrameRef.current = window.requestAnimationFrame(() => {
          setPanelEntered(true);
          panelFrameRef.current = null;
        });
      }
      return;
    }

    if (!panelMountedRef.current) return;

    setPanelEntered(false);
    if (reducedMotion) {
      panelMountedRef.current = false;
      setPanelMounted(false);
      setPanelExiting(false);
      return;
    }

    setPanelExiting(true);
    panelExitTimeoutRef.current = window.setTimeout(() => {
      panelMountedRef.current = false;
      setPanelMounted(false);
      setPanelExiting(false);
      panelExitTimeoutRef.current = null;
    }, PANEL_TRANSITION_MS);
  }, [panelOpen, reducedMotion]);

  useEffect(
    () => () => {
      if (deleteTimeoutRef.current !== null) window.clearTimeout(deleteTimeoutRef.current);
      if (panelExitTimeoutRef.current !== null) {
        window.clearTimeout(panelExitTimeoutRef.current);
      }
      if (panelFrameRef.current !== null) window.cancelAnimationFrame(panelFrameRef.current);
    },
    [],
  );

  const voiceLabel = !supported
    ? labels.voiceUnsupported
    : error
      ? error
      : listening
        ? labels.voiceStop
        : labels.voiceInput;

  const runDeleteAnimation = (action: () => void) => {
    if (reducedMotion) {
      if (deleteTimeoutRef.current !== null) {
        window.clearTimeout(deleteTimeoutRef.current);
        deleteTimeoutRef.current = null;
      }
      if (panelExitTimeoutRef.current !== null) {
        window.clearTimeout(panelExitTimeoutRef.current);
        panelExitTimeoutRef.current = null;
      }
      if (panelFrameRef.current !== null) {
        window.cancelAnimationFrame(panelFrameRef.current);
        panelFrameRef.current = null;
      }
      action();
      setDeleting(false);
      setPanelOpen(false);
      panelMountedRef.current = false;
      setPanelMounted(false);
      setPanelEntered(false);
      setPanelExiting(false);
      return;
    }
    setDeleting(true);
    deleteTimeoutRef.current = window.setTimeout(
      () => {
        action();
        setDeleting(false);
        setPanelOpen(false);
        deleteTimeoutRef.current = null;
      },
      BAR_COUNT * DELETE_STAGGER * 1000 + DELETE_DURATION * 1000,
    );
  };

  const handleToggle = () => {
    if (!supported || disabled) return;
    if (listening) {
      runDeleteAnimation(onToggle);
      return;
    }
    onToggle();
  };

  const handleCancel = () => {
    if (!listening && !panelOpen) return;
    runDeleteAnimation(onCancel);
  };

  const buttonClass =
    variant === 'hero'
      ? listening
        ? 'flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-[#ff5fbf]/22 text-[#ff5fbf] ring-1 ring-[#ff5fbf]/55 transition-colors'
        : 'flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-white/[0.055] text-white/52 transition-colors hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:opacity-45'
      : cn(
          'flex min-h-11 min-w-11 items-center justify-center rounded-full transition-colors',
          listening
            ? 'bg-[#ff5fbf]/18 text-[#ff8ecf] ring-1 ring-[#ff5fbf]/40'
            : 'text-white/44 hover:bg-white/[0.07] hover:text-white/78',
          disabled && 'cursor-not-allowed opacity-40',
        );

  return (
    <div className="relative">
      {panelMounted ? (
        <div
          className={cn(
            'voice-input-panel',
            panelEntered && 'voice-input-panel--open',
            panelExiting && 'voice-input-panel--exiting',
            'absolute bottom-full z-20 mb-2 flex items-center gap-2 rounded-full bg-[#1c1c1c]/95 px-2 py-2 shadow-[0_16px_40px_-20px_rgba(255,95,191,0.45)] ring-1 ring-white/[0.1] backdrop-blur-md',
            variant === 'hero' ? 'left-0 min-w-[min(100%,280px)]' : 'right-0 min-w-[240px]',
          )}
        >
          <button
            type="button"
            onClick={handleCancel}
            aria-label={labels.voiceCancel}
            title={labels.voiceCancel}
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[#ff4d4d]/12 text-[#ff7b7b] ring-1 ring-[#ff4d4d]/20 transition-colors hover:bg-[#ff4d4d]/20"
          >
            <TrashIcon size={16} stroke={2.2} />
          </button>
          <VoiceWaveform deleting={deleting} listening={listening} reducedMotion={reducedMotion} />
          <span
            aria-hidden
            className={cn(
              'voice-input-status-dot h-2 w-2 shrink-0 rounded-full bg-[#ff5fbf]',
              listening && !deleting && !reducedMotion && 'voice-input-status-dot--active',
            )}
          />
        </div>
      ) : null}

      <button
        type="button"
        onClick={handleToggle}
        disabled={!supported || disabled}
        aria-pressed={listening}
        aria-label={voiceLabel}
        title={voiceLabel}
        className={buttonClass}
      >
        {listening ? (
          <MicrophoneIcon
            size={variant === 'hero' ? 17 : 16}
            stroke={2.1}
            className={cn(!reducedMotion && 'voice-input-microphone--active')}
          />
        ) : supported ? (
          <MicrophoneIcon size={variant === 'hero' ? 17 : 16} stroke={2.1} />
        ) : (
          <MicrophoneOffIcon size={variant === 'hero' ? 17 : 16} stroke={2.1} />
        )}
      </button>
    </div>
  );
}
