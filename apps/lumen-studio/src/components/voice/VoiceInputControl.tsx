'use client';

import { cn } from '@/lib/cn';
import { IconMicrophone, IconMicrophoneOff, IconTrash } from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState } from 'react';

const BAR_COUNT = 14;
const DELETE_STAGGER = 0.022;
const DELETE_DURATION = 0.26;

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
  const heights = useWaveformHeights(listening && !deleting);
  const seeds = useMemo(
    () => Array.from({ length: BAR_COUNT }, (_, index) => 0.28 + (index % 5) * 0.08),
    [],
  );

  return (
    <div className="flex h-7 min-w-[132px] flex-1 items-center justify-center gap-[3px] px-1">
      {seeds.map((seed, index) => (
        <motion.span
          key={`voice-bar-${index}`}
          className="w-[3px] origin-bottom rounded-full bg-gradient-to-t from-[#ff5fbf] to-[#ff8ecf]"
          initial={false}
          animate={{
            scaleY: deleting ? 0 : listening ? heights[index] ?? seed : seed,
            opacity: deleting ? 0 : 1,
          }}
          transition={
            reducedMotion
              ? { duration: 0.01 }
              : deleting
                ? {
                    duration: DELETE_DURATION,
                    delay: index * DELETE_STAGGER,
                    ease: [0.32, 0.72, 0, 1],
                  }
                : {
                    duration: 0.12,
                    ease: [0.22, 1, 0.36, 1],
                  }
          }
          style={{ height: 22 * seed }}
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
  const [reducedMotion, setReducedMotion] = useState(false);
  const timeoutRef = useRef<number | null>(null);

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

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
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
      action();
      setPanelOpen(false);
      return;
    }
    setDeleting(true);
    timeoutRef.current = window.setTimeout(() => {
      action();
      setDeleting(false);
      setPanelOpen(false);
      timeoutRef.current = null;
    }, BAR_COUNT * DELETE_STAGGER * 1000 + DELETE_DURATION * 1000);
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
      <AnimatePresence>
        {panelOpen ? (
          <motion.div
            key="voice-panel"
            initial={reducedMotion ? false : { opacity: 0, y: 10, scale: 0.94 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reducedMotion ? undefined : { opacity: 0, y: 8, scale: 0.96 }}
            transition={{ duration: 0.28, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
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
              <IconTrash size={16} stroke={2.2} />
            </button>
            <VoiceWaveform deleting={deleting} listening={listening} reducedMotion={reducedMotion} />
            <motion.span
              aria-hidden
              animate={listening && !deleting ? { opacity: [0.45, 1, 0.45] } : { opacity: 0.5 }}
              transition={{ duration: 1.2, repeat: listening && !deleting ? Number.POSITIVE_INFINITY : 0 }}
              className="h-2 w-2 shrink-0 rounded-full bg-[#ff5fbf]"
            />
          </motion.div>
        ) : null}
      </AnimatePresence>

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
          <IconMicrophone size={variant === 'hero' ? 17 : 16} stroke={2.1} className="animate-pulse" />
        ) : supported ? (
          <IconMicrophone size={variant === 'hero' ? 17 : 16} stroke={2.1} />
        ) : (
          <IconMicrophoneOff size={variant === 'hero' ? 17 : 16} stroke={2.1} />
        )}
      </button>
    </div>
  );
}
