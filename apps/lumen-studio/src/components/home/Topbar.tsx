'use client';

import { NotificationsPopover } from '@/components/home/NotificationsPopover';
import { LanguageToggle } from '@/components/i18n/LanguageToggle';
import { LumenMark } from '@/components/ui/LumenMark';
import { useI18n } from '@/i18n/provider';
import { stripLocalePrefix } from '@/i18n/routing';
import { useLoginRedirect } from '@/lib/auth-redirect';
import { cn } from '@/lib/cn';
import { isLoginRequiredPath } from '@/lib/protected-paths';
import { UserButton } from '@clerk/nextjs';
import { IconChartBar, IconDeviceTv, IconFolder, IconHome, IconPhoto } from '@tabler/icons-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { MouseEvent } from 'react';

const navItems = [
  { labelKey: 'nav.home', href: '/home', icon: IconHome },
  { labelKey: 'nav.studio', href: '/canvas/projects', activePrefix: '/canvas', icon: IconFolder },
  { labelKey: 'nav.materials', href: '/materials', icon: IconPhoto },
  { labelKey: 'nav.hotVideos', href: '/hot-videos', icon: IconDeviceTv },
  { labelKey: 'nav.dashboard', href: '/dashboard', icon: IconChartBar },
];

export function Topbar() {
  const pathname = usePathname();
  const normalizedPath = stripLocalePrefix(pathname || '/');
  const { t, localePath } = useI18n();
  const { isLoaded: authLoaded, isSignedIn, requireLogin } = useLoginRedirect();
  const authRedirect = encodeURIComponent(pathname || '/');

  const handleProtectedNavClick = (event: MouseEvent<HTMLAnchorElement>, href: string) => {
    if (!authLoaded || !isLoginRequiredPath(href)) return;
    if (!requireLogin(href)) event.preventDefault();
  };

  return (
    <header className="fixed inset-x-0 top-0 z-40">
      <div className="border-b border-white/[0.06] bg-[#111315]/95 backdrop-blur-xl">
        <div className="relative flex h-20 w-full items-center gap-6 px-6">
          <Link href={localePath('/home')} className="flex items-center gap-3">
            <LumenMark size={34} />
            <span className="font-display text-[17px] font-bold tracking-tight text-white">
              Lumen
            </span>
          </Link>

          <nav className="absolute left-1/2 top-1/2 hidden -translate-x-1/2 -translate-y-1/2 items-center gap-1 rounded-full bg-white/[0.035] p-1 ring-1 ring-white/[0.06] lg:flex">
            {navItems.map((item) => {
              const Icon = item.icon;
              const active =
                item.href === '/'
                  ? normalizedPath === '/'
                  : normalizedPath.startsWith(item.activePrefix ?? item.href);
              const label = t(item.labelKey);

              return (
                <Link
                  key={item.href}
                  href={localePath(item.href)}
                  onClick={(event) => handleProtectedNavClick(event, item.href)}
                  className={cn(
                    'relative flex items-center gap-1.5 rounded-full px-4 py-2 text-[13px] font-medium transition-colors',
                    active ? 'text-white' : 'text-white/55 hover:text-white',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="home-nav-active"
                      className="absolute inset-0 rounded-full bg-white/[0.08]"
                      transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                    />
                  )}
                  <Icon size={15} className="relative z-10" stroke={2.2} />
                  <span className="relative z-10">{label}</span>
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-2">
            <NotificationsPopover />
            <LanguageToggle compact />

            {(!authLoaded || !isSignedIn) && (
              <div className="hidden items-center gap-2 sm:flex">
                <Link
                  href={localePath(`/sign-in?redirect_url=${authRedirect}`)}
                  className="rounded-full px-3.5 py-1.5 text-[13px] font-medium text-white/70 transition-colors hover:text-white"
                >
                  {t('common.login')}
                </Link>
                <Link
                  href={localePath(`/sign-up?redirect_url=${authRedirect}`)}
                  className="rounded-full bg-white px-3.5 py-1.5 text-[13px] font-semibold text-black transition-opacity hover:opacity-90"
                >
                  {t('common.signup')}
                </Link>
              </div>
            )}

            {authLoaded && isSignedIn && (
              <UserButton
                appearance={{
                  elements: {
                    avatarBox: 'h-9 w-9 ring-2 ring-white/15',
                  },
                }}
              />
            )}
          </div>
        </div>
      </div>

      <nav className="fixed inset-x-4 bottom-4 z-50 grid grid-cols-5 gap-1 rounded-2xl bg-[#111315]/92 p-1 ring-1 ring-white/[0.08] backdrop-blur-xl lg:hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active =
            item.href === '/'
              ? normalizedPath === '/'
              : normalizedPath.startsWith(item.activePrefix ?? item.href);
          const label = t(item.labelKey);

          return (
            <Link
              key={item.href}
              href={localePath(item.href)}
              aria-label={label}
              onClick={(event) => handleProtectedNavClick(event, item.href)}
              className={cn(
                'relative flex h-11 items-center justify-center rounded-xl transition-colors',
                active ? 'text-[#111315]' : 'text-white/58 hover:text-white',
              )}
            >
              {active && (
                <motion.span
                  layoutId="mobile-home-nav-active"
                  className="absolute inset-0 rounded-xl bg-white"
                  transition={{ type: 'spring', stiffness: 260, damping: 24 }}
                />
              )}
              <Icon size={18} className="relative z-10" stroke={2.2} />
            </Link>
          );
        })}
      </nav>
    </header>
  );
}
