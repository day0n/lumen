'use client';

import { useI18n } from '@/i18n/provider';
import { type Locale, switchLocalePath } from '@/i18n/routing';
import { cn } from '@/lib/cn';
import { IconChevronDown, IconWorld } from '@tabler/icons-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

const languageOptions: { locale: Locale; label: string }[] = [
  { locale: 'en', label: 'English' },
  { locale: 'zh', label: '中文' },
];

export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const nextLocale: Locale = locale === 'zh' ? 'en' : 'zh';
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;

    const handlePointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
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

  const handleSelect = (targetLocale: Locale) => {
    setOpen(false);
    if (targetLocale === locale) return;
    setLocale(targetLocale);
    const search = searchParams.toString();
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    router.push(
      `${switchLocalePath(pathname || '/', targetLocale)}${search ? `?${search}` : ''}${hash}`,
    );
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
        className={cn(
          'group inline-flex items-center justify-center rounded-full border border-[#2e3947] bg-[#070809]/95 font-black text-white shadow-[0_14px_38px_rgba(0,0,0,0.28)] transition-all duration-300 hover:border-[#455469] hover:bg-[#0b0d0f] hover:shadow-[0_18px_48px_rgba(0,0,0,0.34)]',
          compact
            ? 'h-11 min-w-[142px] gap-2 px-4 text-[19px]'
            : 'h-11 min-w-[152px] gap-2.5 px-4 text-[20px]',
        )}
      >
        <IconWorld size={compact ? 23 : 24} stroke={2.4} className="shrink-0" />
        <span className="min-w-[54px] text-left leading-none">
          {locale === 'zh' ? '中文' : 'English'}
        </span>
        <IconChevronDown
          size={compact ? 19 : 20}
          stroke={2.6}
          className={cn(
            'shrink-0 transition-transform duration-300',
            open ? 'rotate-180' : 'rotate-0',
          )}
        />
      </button>

      <div
        role="menu"
        aria-label={t('common.language')}
        className={cn(
          'absolute right-0 top-[calc(100%+10px)] w-[198px] overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#050506] py-2 text-[21px] font-semibold text-white shadow-[0_24px_70px_rgba(0,0,0,0.42)] transition-all duration-200 ease-out',
          open
            ? 'translate-y-0 scale-100 opacity-100'
            : 'pointer-events-none -translate-y-2 scale-[0.98] opacity-0',
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
              className={cn(
                'flex h-[72px] w-full items-center px-8 text-left transition-colors duration-200',
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
