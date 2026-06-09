'use client';

import {
  DEFAULT_LOCALE,
  LUMEN_LOCALE_COOKIE,
  type Locale,
  getLocaleFromPathname,
  isLocale,
  localePath,
} from '@/i18n/routing';
import { readMessageArray, translate } from '@/i18n/messages';
import { usePathname } from 'next/navigation';
import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string;
  ta: (key: string) => string[];
  localePath: (href: string, localeOverride?: Locale) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({
  children,
  initialLocale,
}: {
  children: ReactNode;
  initialLocale?: Locale;
}) {
  const pathname = usePathname();
  const [locale, setLocaleState] = useState<Locale>(() => resolveClientLocale(initialLocale, pathname));
  const routeLocale = useMemo(() => getLocaleFromPathname(pathname || '/'), [pathname]);

  useEffect(() => {
    if (routeLocale !== locale) {
      setLocaleState(routeLocale);
    }
    // The route is canonical: unprefixed paths are English and /zh paths are Chinese.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeLocale]);

  useEffect(() => {
    persistLocale(locale);
    document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
  }, [locale]);

  const setLocale = useCallback((nextLocale: Locale) => {
    if (!isLocale(nextLocale)) return;
    setLocaleState(nextLocale);
    persistLocale(nextLocale);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t: (key, params) => translate(locale, key, params),
      ta: (key) => readMessageArray(locale, key),
      localePath: (href, localeOverride) => localePath(href, localeOverride ?? locale),
    }),
    [locale, setLocale],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used inside I18nProvider');
  }
  return value;
}

function resolveClientLocale(initialLocale: Locale | undefined, pathname: string): Locale {
  if (initialLocale) return initialLocale;
  if (pathname) {
    const routeLocale = getLocaleFromPathname(pathname);
    if (routeLocale !== DEFAULT_LOCALE) return routeLocale;
  }
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(LUMEN_LOCALE_COOKIE);
    if (isLocale(stored)) return stored;
    return getLocaleFromPathname(window.location.pathname);
  }
  return DEFAULT_LOCALE;
}

function persistLocale(locale: Locale) {
  if (typeof document !== 'undefined') {
    document.cookie = `${LUMEN_LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; sameSite=lax`;
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LUMEN_LOCALE_COOKIE, locale);
  }
}
