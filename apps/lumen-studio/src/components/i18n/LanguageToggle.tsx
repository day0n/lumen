'use client';

import { useI18n } from '@/i18n/provider';
import { type Locale, switchLocalePath } from '@/i18n/routing';
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
      className={
        compact
          ? 'flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-white/70 ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.1] hover:text-white'
          : 'inline-flex h-9 items-center justify-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-[12px] font-bold text-white/74 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.1] hover:text-white'
      }
    >
      <IconLanguage size={compact ? 17 : 15} stroke={2.2} />
      {compact ? null : <span>{locale === 'zh' ? '中文' : 'EN'}</span>}
    </button>
  );
}
