'use client';

import Link from '@app/compat/next-link';
import { usePathname, useRouter } from '@app/compat/next-navigation';
import { LanguageToggle } from '@app/components/shell/LanguageToggle';
import { LumenMark } from '@app/components/shell/LumenMark';
import { useI18n } from '@app/i18n/provider';
import { stripLocalePrefix } from '@app/i18n/routing';
import { useLoginRedirect } from '@app/lib/auth-redirect';
import { cn } from '@app/lib/cn';
import { isLoginRequiredPath } from '@app/lib/protected-paths';
import { UserButton } from '@clerk/react';
import { Suspense, lazy, useEffect, useState } from 'react';
import type { MouseEvent } from 'react';
import { DeviceTvIcon, FolderIcon, HomeIcon, PhotoIcon } from './shell-icons';

const NotificationsPopover = lazy(() =>
  import('./NotificationsPopover').then((module) => ({
    default: module.NotificationsPopover,
  })),
);

const navItems = [
  {
    labelKey: 'nav.home',
    href: '/app/home',
    activePaths: ['/app/home'],
    icon: HomeIcon,
  },
  {
    labelKey: 'nav.studio',
    href: '/app/projects',
    activePaths: ['/app/projects', '/app/canvas'],
    icon: FolderIcon,
  },
  {
    labelKey: 'nav.materials',
    href: '/app/materials',
    activePaths: ['/app/materials'],
    icon: PhotoIcon,
  },
  {
    labelKey: 'nav.hotVideos',
    href: '/app/hot-videos',
    activePaths: ['/app/hot-videos'],
    icon: DeviceTvIcon,
  },
];

export function Topbar() {
  const router = useRouter();
  const pathname = usePathname();
  const normalizedPath = stripLocalePrefix(pathname || '/');
  const [pendingPath, setPendingPath] = useState<string | null>(null);
  const { t } = useI18n();
  const { isLoaded: authLoaded, isSignedIn, requireLogin } = useLoginRedirect();
  const authRedirect = encodeURIComponent(pathname || '/');
  const activePath = pendingPath ?? normalizedPath;

  useEffect(() => {
    if (!pendingPath) return;
    const timeoutId = window.setTimeout(() => setPendingPath(null), 1500);
    return () => window.clearTimeout(timeoutId);
  }, [pendingPath]);

  const handleProtectedNavClick = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!authLoaded || !isLoginRequiredPath(href)) return;
    if (!requireLogin(href)) {
      event.preventDefault();
      return;
    }
    setPendingPath(readNavPath(href));
    handleNavIntent(href);
  };

  const handleNavIntent = (href: string, activate = false) => {
    if (activate && (isSignedIn || !isLoginRequiredPath(href))) {
      setPendingPath(readNavPath(href));
    }
    try {
      router.prefetch(href);
    } catch {}
  };

  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <div className="border-b border-white/[0.06] bg-[#111315]/95 backdrop-blur-xl">
        <div className="relative flex h-16 w-full min-w-0 items-center gap-2 px-3 sm:h-20 sm:gap-4 sm:px-6">
          <Link
            href="/app/home"
            prefetch={false}
            aria-label={t('nav.home')}
            className="flex min-h-11 min-w-11 shrink-0 items-center gap-2 sm:gap-3"
          >
            <LumenMark size={30} className="sm:hidden" />
            <LumenMark size={34} className="hidden sm:block" />
            <span className="hidden font-display text-[17px] font-bold tracking-tight text-white sm:inline">
              Lumen
            </span>
          </Link>

          <nav className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-white/[0.035] p-1 ring-1 ring-white/[0.06] lg:flex">
            {navItems.map((item) => {
              const Icon = item.icon;
              const href = item.href;
              const active = isNavItemActive(activePath, item.activePaths);
              const label = t(item.labelKey);

              return (
                <Link
                  key={href}
                  href={href}
                  prefetch={false}
                  onClick={(event) => handleProtectedNavClick(event, href)}
                  onFocus={() => handleNavIntent(href)}
                  onMouseDown={() => handleNavIntent(href, true)}
                  onPointerEnter={() => handleNavIntent(href)}
                  onTouchStart={() => handleNavIntent(href, true)}
                  className={cn(
                    'relative flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-medium transition-colors',
                    active ? 'text-white' : 'text-white/55 hover:text-white',
                  )}
                >
                  <span
                    aria-hidden
                    className={cn(
                      'pointer-events-none absolute inset-0 rounded-full bg-white/[0.08] transition-opacity duration-200 motion-reduce:transition-none',
                      active ? 'opacity-100' : 'opacity-0',
                    )}
                  />
                  <Icon size={15} className="relative z-10" stroke={2.2} />
                  <span className="relative z-10">{label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex min-w-0 shrink-0 items-center gap-1 sm:gap-2">
            {authLoaded && isSignedIn ? (
              <Suspense fallback={<NotificationSlotFallback />}>
                <NotificationsPopover />
              </Suspense>
            ) : null}
            <LanguageToggle compact iconOnlyOnMobile />

            {!authLoaded && (
              <div
                aria-hidden
                className="h-9 w-9 shrink-0 animate-pulse rounded-full bg-white/[0.08]"
              />
            )}

            {authLoaded && !isSignedIn && (
              <div className="flex items-center gap-1">
                <Link
                  href={`/sign-in?redirect_url=${authRedirect}`}
                  prefetch={false}
                  className="hidden min-h-11 items-center rounded-full px-3 text-[13px] font-medium text-white/70 transition-colors hover:text-white sm:flex"
                >
                  {t('common.login')}
                </Link>
                <Link
                  href={`/sign-up?redirect_url=${authRedirect}`}
                  prefetch={false}
                  className="flex min-h-11 max-w-[108px] items-center justify-center truncate rounded-full bg-white px-3 text-[12px] font-semibold text-black transition-opacity hover:opacity-90 sm:max-w-none sm:px-3.5 sm:text-[13px]"
                >
                  {t('common.signup')}
                </Link>
              </div>
            )}

            {authLoaded && isSignedIn && (
              <UserButton
                appearance={{
                  elements: {
                    avatarBox: 'h-9 w-9 ring-2 ring-white/15 sm:h-9 sm:w-9',
                  },
                }}
              />
            )}
          </div>
        </div>
      </div>

      <nav className="fixed inset-x-4 bottom-4 z-50 grid grid-cols-5 gap-1 rounded-2xl bg-[#111315]/92 p-1 pb-[max(0.25rem,env(safe-area-inset-bottom))] ring-1 ring-white/[0.08] backdrop-blur-xl lg:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const href = item.href;
          const active = isNavItemActive(activePath, item.activePaths);
          const label = t(item.labelKey);

          return (
            <Link
              key={href}
              href={href}
              prefetch={false}
              aria-label={label}
              onClick={(event) => handleProtectedNavClick(event, href)}
              onFocus={() => handleNavIntent(href)}
              onMouseDown={() => handleNavIntent(href, true)}
              onPointerEnter={() => handleNavIntent(href)}
              onTouchStart={() => handleNavIntent(href, true)}
              className={cn(
                'relative flex min-h-11 min-w-11 items-center justify-center rounded-xl transition-colors',
                active ? 'text-[#111315]' : 'text-white/58 hover:text-white',
              )}
            >
              <span
                aria-hidden
                className={cn(
                  'pointer-events-none absolute inset-0 rounded-xl bg-white transition-opacity duration-200 motion-reduce:transition-none',
                  active ? 'opacity-100' : 'opacity-0',
                )}
              />
              <Icon size={18} className="relative z-10" stroke={2.2} />
            </Link>
          );
        })}
      </nav>
    </header>
  );
}

function NotificationSlotFallback() {
  return <span aria-hidden className="block h-11 w-11 shrink-0 rounded-xl bg-white/[0.04]" />;
}

function isNavItemActive(pathname: string, activePaths: string[]) {
  return activePaths.some((path) => pathname === path || pathname.startsWith(`${path}/`));
}

function readNavPath(href: string) {
  try {
    return stripLocalePrefix(new URL(href, 'https://lumen.local').pathname);
  } catch {
    return href;
  }
}
