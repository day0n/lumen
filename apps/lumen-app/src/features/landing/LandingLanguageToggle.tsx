import { useEffect, useRef, useState } from 'react';
import { cx } from './landing-classes';
import { type LandingLocale, useLandingI18n } from './landing-i18n';

const languageOptions: { locale: LandingLocale; label: string }[] = [
  { locale: 'en', label: 'English' },
  { locale: 'zh', label: '中文' },
];

export function LandingLanguageToggle({ compact = false }: { compact?: boolean }) {
  const { locale, localePath, setLocale, t } = useLandingI18n();
  const nextLocale: LandingLocale = locale === 'zh' ? 'en' : 'zh';
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('pointerdown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const handleSelect = (targetLocale: LandingLocale) => {
    setOpen(false);
    if (targetLocale === locale) return;
    setLocale(targetLocale);
    const targetPath = localePath('/', targetLocale);
    window.location.assign(`${targetPath}${window.location.search}${window.location.hash}`);
  };

  return (
    <div ref={rootRef} className="relative z-50 shrink-0">
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label={nextLocale === 'zh' ? t('common.switchToChinese') : t('common.switchToEnglish')}
        title={nextLocale === 'zh' ? t('common.switchToChinese') : t('common.switchToEnglish')}
        onClick={() => setOpen((current) => !current)}
        className={cx(
          'group inline-flex items-center justify-center rounded-full border border-[#2e3947] bg-[#070809]/95 font-black text-white shadow-[0_14px_38px_rgba(0,0,0,0.28)] transition-all duration-300 hover:border-[#455469] hover:bg-[#0b0d0f] hover:shadow-[0_18px_48px_rgba(0,0,0,0.34)]',
          compact
            ? 'min-h-11 min-w-[104px] gap-1.5 px-3 text-[13px]'
            : 'min-h-11 min-w-[152px] gap-2.5 px-4 text-[20px]',
        )}
      >
        <WorldIcon size={compact ? 15 : 24} stroke={2.4} />
        <span className={cx('text-left leading-none', compact ? 'min-w-[40px]' : 'min-w-[54px]')}>
          {locale === 'zh' ? '中文' : 'English'}
        </span>
        <ChevronDownIcon
          className={cx('transition-transform duration-300', open ? 'rotate-180' : 'rotate-0')}
          size={compact ? 13 : 20}
          stroke={2.6}
        />
      </button>

      <div
        role="menu"
        hidden={!open}
        aria-label={t('common.language')}
        className={cx(
          'absolute right-0 overflow-hidden border border-white/[0.08] bg-[#050506] font-semibold text-white shadow-[0_24px_70px_rgba(0,0,0,0.42)] transition-all duration-200 ease-out',
          compact
            ? 'top-[calc(100%+8px)] w-[140px] rounded-[16px] py-1.5 text-[14px]'
            : 'top-[calc(100%+10px)] w-[198px] rounded-[24px] py-2 text-[21px]',
          open ? 'translate-y-0 scale-100 opacity-100' : '-translate-y-2 scale-[0.98] opacity-0',
        )}
      >
        {languageOptions.map((option) => {
          const active = option.locale === locale;
          return (
            <button
              key={option.locale}
              type="button"
              role="menuitemradio"
              aria-checked={active}
              onClick={() => handleSelect(option.locale)}
              className={cx(
                'flex w-full items-center text-left transition-colors duration-200',
                compact ? 'min-h-12 px-5' : 'min-h-[72px] px-8',
                active
                  ? 'bg-[#3a1b33] text-[#ff65d8]'
                  : 'text-white hover:bg-white/[0.06] hover:text-white',
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function WorldIcon({ size, stroke }: { size: number; stroke: number }) {
  return (
    <svg
      aria-hidden
      className="shrink-0"
      fill="none"
      focusable="false"
      height={size}
      role="presentation"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={stroke}
      viewBox="0 0 24 24"
      width={size}
    >
      <circle cx="12" cy="12" r="9" />
      <path d="M3.6 9h16.8M3.6 15h16.8M11.5 3a17 17 0 0 0 0 18M12.5 3a17 17 0 0 1 0 18" />
    </svg>
  );
}

function ChevronDownIcon({
  className,
  size,
  stroke,
}: {
  className?: string;
  size: number;
  stroke: number;
}) {
  return (
    <svg
      aria-hidden
      className={cx('shrink-0', className)}
      fill="none"
      focusable="false"
      height={size}
      role="presentation"
      stroke="currentColor"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={stroke}
      viewBox="0 0 24 24"
      width={size}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}
