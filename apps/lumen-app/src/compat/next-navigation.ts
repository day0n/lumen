import { useLocation } from '@tanstack/react-router';
import { useMemo } from 'react';
import { toRouterPath } from '../lib/path-map';
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
      },
      back: () => window.history.back(),
      refresh: () => window.location.reload(),
    }),
    [],
  );
}

export function usePathname() {
  const location = useLocation();
  return location.pathname;
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
  const target = toRouterPath(href);
  if (!target) {
    if (replace) window.location.replace(href);
    else window.location.assign(href);
    return;
  }

  void router.navigate({
    to: target.to as never,
    search: target.search as never,
    replace,
  });
}
