'use client';

import { useI18n } from '@/i18n/provider';
import { useLoginRedirect } from '@/lib/auth-redirect';
import { cn } from '@/lib/cn';
import {
  IconBell,
  IconChevronDown,
  IconLoader2,
  IconSpeakerphone,
  IconX,
} from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useState } from 'react';

interface OfficialNotification {
  id: string;
  title: string;
  body: string;
  publishedAt: string;
  isRead: boolean;
}

type NotificationsApiResponse =
  | {
      ok: true;
      data: {
        notifications: OfficialNotification[];
        unreadCount: number;
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

export function NotificationsPopover({ triggerClassName }: { triggerClassName?: string } = {}) {
  const { locale, t } = useI18n();
  const { isLoaded: authLoaded, isSignedIn, requireLogin } = useLoginRedirect();
  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState<OfficialNotification[]>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorText, setErrorText] = useState<string | null>(null);

  const unreadCount = useMemo(
    () => notifications.filter((notification) => !notification.isRead).length,
    [notifications],
  );

  useEffect(() => {
    if (!authLoaded) return;

    if (!isSignedIn) {
      setNotifications([]);
      setExpandedId(null);
      setErrorText(null);
      setLoading(false);
      return;
    }

    const controller = new AbortController();

    async function loadNotifications() {
      try {
        setLoading(true);
        const response = await fetch('/api/notifications/official', {
          signal: controller.signal,
          headers: { 'x-lumen-locale': locale },
        });
        const payload = (await response.json()) as NotificationsApiResponse;

        if (!response.ok || !payload.ok) {
          throw new Error(payload.ok ? t('notifications.readFailed') : payload.error.message);
        }

        setNotifications(payload.data.notifications);
        setExpandedId(payload.data.notifications[0]?.id ?? null);
        setErrorText(null);
      } catch (error) {
        if (!controller.signal.aborted) {
          setErrorText(error instanceof Error ? error.message : t('notifications.readFailed'));
        }
      } finally {
        if (!controller.signal.aborted) {
          setLoading(false);
        }
      }
    }

    void loadNotifications();
    return () => controller.abort();
  }, [authLoaded, isSignedIn, locale, t]);

  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  const handleToggle = (notification: OfficialNotification) => {
    setExpandedId((current) => (current === notification.id ? null : notification.id));

    if (notification.isRead) return;
    setNotifications((current) =>
      current.map((item) => (item.id === notification.id ? { ...item, isRead: true } : item)),
    );

    void fetch(`/api/notifications/official/${notification.id}/read`, {
      method: 'POST',
    }).catch(() => {
      setNotifications((current) =>
        current.map((item) => (item.id === notification.id ? { ...item, isRead: false } : item)),
      );
    });
  };

  return (
    <>
      <button
        type="button"
        aria-label={t('notifications.aria')}
        onClick={() => {
          if (!requireLogin()) return;
          setOpen(true);
        }}
        className={cn(
          'relative flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.06] text-white/65 ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.1] hover:text-white',
          triggerClassName,
        )}
      >
        <IconBell size={17} stroke={2.1} />
        {unreadCount > 0 ? (
          <span className="absolute right-1.5 top-1.5 h-2 w-2 rounded-full bg-[#ff5b5f] shadow-[0_0_14px_rgba(255,91,95,0.72)]" />
        ) : null}
      </button>

      <AnimatePresence>
        {open ? (
          <motion.div
            className="fixed inset-0 z-[80] flex items-start justify-center bg-black/58 px-4 pt-[92px] backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget) setOpen(false);
            }}
          >
            <motion.div
              className="flex h-[560px] max-h-[calc(100vh-136px)] w-full max-w-[760px] overflow-hidden rounded-xl bg-[#191a1c] text-white shadow-[0_32px_100px_rgba(0,0,0,0.58)] ring-1 ring-white/[0.1]"
              initial={{ opacity: 0, y: 16, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.98 }}
              transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
            >
              <aside className="flex w-[190px] shrink-0 flex-col border-r border-white/[0.07] bg-[#1f2021]">
                <div className="flex h-14 items-center px-5 text-[15px] font-bold">
                  {t('notifications.title')}
                </div>
                <div className="px-4">
                  <div className="flex h-10 items-center justify-between rounded-lg bg-white/[0.08] px-3 text-[13px] font-semibold text-white/86">
                    <span className="flex items-center gap-2">
                      <IconSpeakerphone size={15} stroke={2.2} />
                      {t('notifications.official')}
                    </span>
                    {unreadCount > 0 ? (
                      <span className="min-w-5 rounded-full bg-[#ff5b5f] px-1.5 py-0.5 text-center text-[10px] font-bold text-white">
                        {unreadCount}
                      </span>
                    ) : null}
                  </div>
                </div>
              </aside>

              <section className="flex min-w-0 flex-1 flex-col">
                <header className="flex h-14 shrink-0 items-center justify-between border-b border-white/[0.07] px-4">
                  <div>
                    <div className="text-[14px] font-bold">{t('notifications.official')}</div>
                    <div className="mt-0.5 text-[11px] text-white/38">
                      {t('notifications.subtitle')}
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label={t('common.close')}
                    onClick={() => setOpen(false)}
                    className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.08] text-white/58 transition-colors hover:bg-white/[0.12] hover:text-white"
                  >
                    <IconX size={17} stroke={2.1} />
                  </button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto bg-[#111214] p-4">
                  {loading ? (
                    <div className="flex h-full items-center justify-center text-[13px] text-white/42">
                      <IconLoader2 size={18} className="mr-2 animate-spin" stroke={2.2} />
                      {t('notifications.loading')}
                    </div>
                  ) : errorText ? (
                    <div className="rounded-xl bg-[#2a171a]/72 px-4 py-3 text-[13px] text-[#ffabb6] ring-1 ring-[#ff5d73]/16">
                      {errorText}
                    </div>
                  ) : notifications.length === 0 ? (
                    <div className="flex h-full items-center justify-center text-[13px] text-white/38">
                      {t('notifications.empty')}
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      {notifications.map((notification) => {
                        const expanded = expandedId === notification.id;

                        return (
                          <button
                            key={notification.id}
                            type="button"
                            onClick={() => handleToggle(notification)}
                            className={cn(
                              'relative block w-full rounded-lg border p-4 text-left transition-colors',
                              expanded
                                ? 'border-white/[0.16] bg-[#26282a]'
                                : 'border-white/[0.08] bg-[#202123] hover:bg-[#252729]',
                            )}
                          >
                            <div className="flex items-start gap-3">
                              <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-2">
                                  <div className="truncate text-[13px] font-bold text-white/90">
                                    {notification.title}
                                  </div>
                                  {!notification.isRead ? (
                                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-[#ff5b5f]" />
                                  ) : null}
                                </div>
                                <div className="mt-2 text-[12px] text-white/34">
                                  {formatDateTime(notification.publishedAt, locale)}
                                </div>
                              </div>
                              <span className="mt-0.5 flex shrink-0 items-center gap-1 text-[12px] text-white/42">
                                {expanded ? t('common.collapse') : t('common.expand')}
                                <IconChevronDown
                                  size={14}
                                  className={cn('transition-transform', expanded && 'rotate-180')}
                                  stroke={2.1}
                                />
                              </span>
                            </div>
                            <p
                              className={cn(
                                'mt-3 text-[12px] leading-6 text-white/62',
                                !expanded && 'line-clamp-2',
                              )}
                            >
                              {notification.body}
                            </p>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </section>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}

function formatDateTime(value: string, locale: 'en' | 'zh') {
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: locale === 'en',
  })
    .format(new Date(value))
    .replace(/\//g, '-');
}
