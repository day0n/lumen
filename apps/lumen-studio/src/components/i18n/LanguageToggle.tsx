'use client';

import { useI18n } from '@/i18n/provider';
import { type Locale, switchLocalePath } from '@/i18n/routing';
import { cn } from '@/lib/cn';
import { IconLanguage } from '@tabler/icons-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export function LanguageToggle({ compact = false }: { compact?: boolean }) {
  const { locale, setLocale, t } = useI18n();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const router = useRouter();
  const nextLocale: Locale = locale === 'zh' ? 'en' : 'zh';

  const handleToggle = () => {
    setLocale(nextLocale);
    const search = searchParams.toString();
    const hash = typeof window !== 'undefined' ? window.location.hash : '';
    router.push(
      `${switchLocalePath(pathname || '/', nextLocale)}${search ? `?${search}` : ''}${hash}`,
    );
  };

  return (
    <button
      type="button"
      aria-label={nextLocale === 'zh' ? t('common.switchToChinese') : t('common.switchToEnglish')}
      title={nextLocale === 'zh' ? t('common.switchToChinese') : t('common.switchToEnglish')}
      onClick={handleToggle}
      className={cn(
        'group relative inline-flex shrink-0 items-center overflow-hidden rounded-full bg-white/[0.055] p-1 text-[11px] font-black text-white/52 ring-1 ring-white/[0.08] transition-all duration-300 hover:bg-white/[0.085] hover:ring-white/[0.14]',
        compact ? 'h-9 w-[88px]' : 'h-10 w-[108px]',
      )}
    >
      <span
        aria-hidden
        className={cn(
          'absolute inset-y-1 w-[calc(50%-4px)] rounded-full bg-white shadow-[0_8px_22px_rgba(0,0,0,0.28)] transition-transform duration-300 ease-out',
          locale === 'zh' ? 'translate-x-[calc(100%+4px)]' : 'translate-x-0',
        )}
      />
      <span
        className={cn(
          'relative z-10 flex h-full flex-1 items-center justify-center gap-1 rounded-full transition-colors duration-300',
          locale === 'en' ? 'text-[#111315]' : 'text-white/52 group-hover:text-white/70',
        )}
      >
        <IconLanguage size={compact ? 13 : 14} stroke={2.4} />
        EN
      </span>
      <span
        className={cn(
          'relative z-10 flex h-full flex-1 items-center justify-center rounded-full transition-colors duration-300',
          locale === 'zh' ? 'text-[#111315]' : 'text-white/52 group-hover:text-white/70',
        )}
      >
        中文
      </span>
    </button>
  );
}
