'use client';

import {
  type ReactNode,
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { toAppPath } from '../lib/path-map';
import { readMessageArray, translate } from './messages';
import {
  DEFAULT_LOCALE,
  LUMEN_LOCALE_COOKIE,
  type Locale,
  isLocale,
  localeFromLanguageTag,
} from './routing';

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
  const [locale, setLocaleState] = useState<Locale>(() => resolveClientLocale(initialLocale));

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
      localePath: (href) => toAppPath(href),
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

function resolveClientLocale(initialLocale: Locale | undefined): Locale {
  if (typeof window !== 'undefined') {
    const stored = readClientStoredLocale();
    if (stored) return stored;
  }

  if (initialLocale) return initialLocale;

  const browserLocale = readBrowserLocale();
  if (browserLocale) return browserLocale;

  return DEFAULT_LOCALE;
}

function readBrowserLocale(): Locale | null {
  if (typeof navigator === 'undefined') return null;
  const tags =
    Array.isArray(navigator.languages) && navigator.languages.length > 0
      ? navigator.languages
      : [navigator.language];
  for (const tag of tags) {
    const locale = localeFromLanguageTag(tag);
    if (locale) return locale;
  }
  return null;
}

function readClientStoredLocale(): Locale | null {
  if (typeof document !== 'undefined') {
    const match = document.cookie
      .split(';')
      .map((part) => part.trim())
      .find((part) => part.startsWith(`${LUMEN_LOCALE_COOKIE}=`));
    if (match) {
      const value = decodeURIComponent(match.slice(LUMEN_LOCALE_COOKIE.length + 1));
      if (isLocale(value)) return value;
    }
  }
  if (typeof window !== 'undefined') {
    const stored = window.localStorage.getItem(LUMEN_LOCALE_COOKIE);
    if (isLocale(stored)) return stored;
  }
  return null;
}

function persistLocale(locale: Locale) {
  if (typeof document !== 'undefined') {
    document.cookie = `${LUMEN_LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; sameSite=lax`;
  }
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(LUMEN_LOCALE_COOKIE, locale);
  }
}
