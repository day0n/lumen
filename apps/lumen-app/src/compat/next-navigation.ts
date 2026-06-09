import { useLocation } from '@tanstack/react-router';
import { useMemo } from 'react';
import { warmAppRouteResources } from '../lib/app-warmup';
import { getLocaleFromPathname, toAppPath, toRouterPath } from '../lib/path-map';
import { router } from '../router';

type NavigateOptions = {
  scroll?: boolean;
};

export function useRouter() {
  return useMemo(
    () => ({
      push: (href: string, _options?: NavigateOptions) => navigateTo(href, false),
      replace: (href: string, _options?: NavigateOptions) => navigateTo(href, true),
      prefetch: (href: string) => {
        const target = toRouterPath(href);
        if (!target) return;
        void router.preloadRoute({
          to: target.to as never,
          search: target.search as never,
        });
        void warmAppRouteResources(href);
      },
      back: () => window.history.back(),
      refresh: () => window.location.reload(),
    }),
    [],
  );
}

export function usePathname() {
  const location = useLocation();
  return useMemo(() => {
    if (typeof window !== 'undefined') return window.location.pathname;
    return `/app${location.pathname}`;
  }, [location.pathname, location.searchStr, location.hash]);
}

export function useSearchParams() {
  const location = useLocation();
  return useMemo(() => {
    const searchStr =
      typeof location.searchStr === 'string'
        ? location.searchStr
        : typeof window !== 'undefined'
          ? window.location.search
          : '';
    return new URLSearchParams(searchStr);
  }, [location.searchStr]);
}

export function redirect(href: string): never {
  if (typeof window !== 'undefined') {
    window.location.assign(href);
  }
  throw new Error(`redirect: ${href}`);
}

export function notFound(): never {
  throw new Error('notFound');
}

function navigateTo(href: string, replace: boolean) {
  const normalizedHref = toAppPath(href);
  const currentLocale = getLocaleFromPathname(window.location.pathname);
  const targetLocale = getLocaleFromPathname(normalizedHref);
  if (currentLocale !== targetLocale) {
    if (replace) window.location.replace(normalizedHref);
    else window.location.assign(normalizedHref);
    return;
  }

  const target = toRouterPath(normalizedHref);
  if (!target) {
    if (replace) window.location.replace(normalizedHref);
    else window.location.assign(normalizedHref);
    return;
  }

  void router.navigate({
    to: target.to as never,
    search: target.search as never,
    replace,
  });
}

