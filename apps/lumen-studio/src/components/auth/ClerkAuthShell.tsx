'use client';

import { useI18n } from '@/i18n/provider';
import { ClerkLoaded, ClerkLoading } from '@clerk/nextjs';
import * as Sentry from '@sentry/nextjs';
import { useCallback, useEffect, useState } from 'react';

const TIMEOUT_MS = 15_000;

type FailureKind = 'timeout' | 'network';

/**
 * Wrap Clerk's <SignIn> / <SignUp> with:
 * - a deterministic loading spinner (instead of Clerk's default empty box)
 * - a timeout that surfaces a network-troubleshooting card if Clerk JS / API
 *   can't be reached (commonly when the user's proxy or VPN blocks
 *   clerk.lumenstudio.tech). Clerk emits unhandled rejections like
 *   "SyntaxError: The string did not match the expected pattern" when
 *   sessions/touch returns 503 or HTML — those would otherwise spin forever.
 */
export function ClerkAuthShell({ children }: { children: React.ReactNode }) {
  const { t, ta } = useI18n();
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [clerkReady, setClerkReady] = useState(false);

  const markClerkReady = useCallback(() => {
    setClerkReady(true);
    setFailure(null);
  }, []);

  useEffect(() => {
    if (clerkReady) return;

    const timer = window.setTimeout(() => {
      setFailure((prev) => prev ?? 'timeout');
    }, TIMEOUT_MS);

    function isClerkFailure(reason: unknown): boolean {
      if (!reason) return false;
      const text =
        typeof reason === 'string'
          ? reason
          : reason instanceof Error
            ? `${reason.name}: ${reason.message}\n${reason.stack ?? ''}`
            : (() => {
                try {
                  return JSON.stringify(reason);
                } catch {
                  return String(reason);
                }
              })();
      return (
        text.includes('clerk.lumenstudio.tech') ||
        text.includes('ClerkJS') ||
        text.includes('clerk.browser.js') ||
        // Safari throws this when Clerk parses a non-JSON 5xx body
        text.includes('The string did not match the expected pattern')
      );
    }

    function onUnhandledRejection(event: PromiseRejectionEvent) {
      if (isClerkFailure(event.reason)) {
        setFailure('network');
      }
    }
    function onError(event: ErrorEvent) {
      if (isClerkFailure(event.error ?? event.message)) {
        setFailure('network');
      }
    }

    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('error', onError);

    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.removeEventListener('error', onError);
    };
  }, [clerkReady]);

  useEffect(() => {
    if (failure && !clerkReady) {
      Sentry.captureMessage(`Clerk auth shell triggered fallback (${failure})`, {
        level: 'warning',
        tags: { feature: 'clerk-auth-shell', failure },
      });
    }
  }, [clerkReady, failure]);

  const reload = useCallback(() => {
    if (typeof window !== 'undefined') {
      window.location.reload();
    }
  }, []);

  if (failure && !clerkReady) {
    return (
      <TroubleshootCard
        title={t('auth.troubleshoot.title')}
        hint={t('auth.troubleshoot.networkHint')}
        tips={ta('auth.troubleshoot.tips')}
        retryLabel={t('auth.troubleshoot.retry')}
        backLabel={t('auth.troubleshoot.backHome')}
        onRetry={reload}
      />
    );
  }

  return (
    <div className="relative w-full">
      <ClerkLoading>
        <Spinner label={t('auth.troubleshoot.title')} loadingLabel={t('auth.loading')} />
      </ClerkLoading>
      <ClerkLoaded>
        <ClerkReadyMarker onReady={markClerkReady}>{children}</ClerkReadyMarker>
      </ClerkLoaded>
    </div>
  );
}

function ClerkReadyMarker({
  children,
  onReady,
}: {
  children: React.ReactNode;
  onReady: () => void;
}) {
  useEffect(() => {
    onReady();
  }, [onReady]);

  return <>{children}</>;
}

function Spinner({ label, loadingLabel }: { label: string; loadingLabel: string }) {
  return (
    <output
      className="flex min-h-[320px] w-full flex-col items-center justify-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-10 text-white/70 sm:min-h-[420px] sm:px-6 sm:py-12"
      aria-live="polite"
      aria-label={label}
    >
      <span
        aria-hidden
        className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-white/80"
      />
      <span className="text-sm tracking-wide text-white/55">{loadingLabel}</span>
    </output>
  );
}

interface TroubleshootCardProps {
  title: string;
  hint: string;
  tips: string[];
  retryLabel: string;
  backLabel: string;
  onRetry: () => void;
}

function TroubleshootCard({
  title,
  hint,
  tips,
  retryLabel,
  backLabel,
  onRetry,
}: TroubleshootCardProps) {
  return (
    <div className="flex w-full flex-col gap-5 rounded-2xl border border-amber-200/15 bg-amber-50/[0.04] p-6 text-white/85 shadow-[0_18px_60px_-32px_rgba(255,180,90,0.45)]">
      <div className="flex items-start gap-3">
        <span
          aria-hidden
          className="mt-1 inline-flex h-2 w-2 shrink-0 rounded-full bg-amber-300/85 shadow-[0_0_12px_rgba(252,211,77,0.65)]"
        />
        <div className="flex flex-col gap-2">
          <h2 className="font-display text-base font-semibold leading-snug">{title}</h2>
          <p className="text-sm leading-relaxed text-white/65">{hint}</p>
        </div>
      </div>
      {tips.length > 0 && (
        <ul className="flex flex-col gap-2 rounded-xl bg-white/[0.03] px-4 py-3 text-[13px] leading-relaxed text-white/60">
          {tips.map((tip, index) => (
            <li key={tip} className="flex gap-2">
              <span aria-hidden className="select-none text-white/30">
                {index + 1}.
              </span>
              <span>{tip}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={onRetry}
          className="inline-flex min-h-11 items-center justify-center rounded-full bg-white/95 px-4 py-2 text-sm font-medium text-black transition hover:bg-white"
        >
          {retryLabel}
        </button>
        <a
          href="/"
          className="inline-flex min-h-11 items-center justify-center rounded-full border border-white/15 px-4 py-2 text-sm text-white/75 transition hover:border-white/25 hover:text-white"
        >
          {backLabel}
        </a>
      </div>
    </div>
  );
}
