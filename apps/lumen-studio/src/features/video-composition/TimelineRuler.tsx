'use client';

export function TimelineRuler({
  duration,
  playhead,
  onSeek,
}: {
  duration: number;
  playhead: number;
  onSeek: (seconds: number) => void;
}) {
  const safeDuration = Math.max(duration, 1);
  const tickCount = Math.min(12, Math.max(4, Math.ceil(safeDuration / 2)));

  return (
    <div
      className="relative h-8 cursor-pointer border-b border-white/[0.08] bg-[#141518]"
      onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        const ratio = Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width));
        onSeek(ratio * safeDuration);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') onSeek(Math.min(safeDuration, playhead + 0.5));
        if (event.key === 'ArrowLeft') onSeek(Math.max(0, playhead - 0.5));
      }}
      role="slider"
      aria-valuemin={0}
      aria-valuemax={safeDuration}
      aria-valuenow={playhead}
      tabIndex={0}
    >
      {Array.from({ length: tickCount + 1 }, (_, index) => {
        const seconds = (safeDuration / tickCount) * index;
        const left = (index / tickCount) * 100;
        return (
          <span
            key={`tick-${index}`}
            className="absolute top-0 flex -translate-x-1/2 flex-col items-center text-[10px] text-white/34"
            style={{ left: `${left}%` }}
          >
            <span className="mb-1 h-2 w-px bg-white/18" />
            {formatRulerLabel(seconds)}
          </span>
        );
      })}
      <span
        className="pointer-events-none absolute inset-y-0 w-px bg-[#9beaff]"
        style={{ left: `${(playhead / safeDuration) * 100}%` }}
      />
    </div>
  );
}

function formatRulerLabel(seconds: number) {
  const whole = Math.floor(seconds);
  const fraction = Math.round((seconds - whole) * 10);
  if (fraction === 0) return `${whole}s`;
  return `${whole}.${fraction}s`;
}
