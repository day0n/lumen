import { useI18n } from '../../i18n/provider';

export function CanvasRouteFallback() {
  const { t } = useI18n();

  return (
    <main className="flex min-h-dvh w-full items-center justify-center bg-[#030304] px-6">
      <output
        className="flex items-center gap-3"
        aria-busy="true"
        aria-live="polite"
        aria-label={t('canvas.entry.opening')}
      >
        <span aria-hidden className="grid size-7 grid-cols-2 gap-1">
          <span className="rounded-full bg-white/80 animate-pulse" />
          <span className="rounded-full bg-white/20 animate-pulse [animation-delay:120ms]" />
          <span className="rounded-full bg-white/20 animate-pulse [animation-delay:240ms]" />
          <span className="rounded-full bg-white/55 animate-pulse [animation-delay:360ms]" />
        </span>
        <span className="canvas-entry-label whitespace-nowrap text-base font-medium">
          {t('canvas.entry.opening')}
        </span>
      </output>
    </main>
  );
}
