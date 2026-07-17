import { zhCN } from '@clerk/localizations';
import { ClerkProvider, useAuth } from '@clerk/react';
import { type ReactNode, useEffect, useRef } from 'react';
import { I18nProvider } from '../i18n/provider';
import type { Locale } from '../i18n/routing';
import {
  clearPrivateApiMemoryCache,
  installApiFetchInterceptor,
  setApiAuthStatusVerifier,
  setApiTokenGetter,
} from '../lib/api-client';

type AuthStatus = 'active' | 'signed-out' | 'unknown';
type AuthSnapshot = {
  isLoaded: boolean;
  isSignedIn: boolean;
};
type AuthSnapshotRef = {
  current: AuthSnapshot;
};

const AUTH_CHECK_TOKEN_TIMEOUT_MS = 3000;
const AUTH_CHECK_RETRY_DELAY_MS = 700;
const AUTH_CHECK_SETTLE_DELAY_MS = 500;
const AUTH_HEARTBEAT_INTERVAL_MS = 60_000;
const AUTH_HEARTBEAT_INITIAL_DELAY_MS = 2500;

function ApiAuthBridge() {
  const { getToken, isLoaded, isSignedIn } = useAuth();
  const authSnapshotRef = useRef<AuthSnapshot>({
    isLoaded,
    isSignedIn: Boolean(isSignedIn),
  });

  useEffect(() => {
    authSnapshotRef.current = {
      isLoaded,
      isSignedIn: Boolean(isSignedIn),
    };
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    if (isLoaded && !isSignedIn) clearPrivateApiMemoryCache();
  }, [isLoaded, isSignedIn]);

  useEffect(() => {
    setApiTokenGetter(() => getToken());
    setApiAuthStatusVerifier(() => verifyCurrentAuth(getToken, authSnapshotRef));
    installApiFetchInterceptor();
    return () => {
      setApiTokenGetter(null);
      setApiAuthStatusVerifier(null);
    };
  }, [getToken]);

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;

    let cancelled = false;
    const ping = () => {
      if (cancelled) return;
      void checkCurrentUser(getToken).catch(() => undefined);
    };
    const pingWhenVisible = () => {
      if (document.visibilityState === 'visible') ping();
    };

    const initialTimer = window.setTimeout(pingWhenVisible, AUTH_HEARTBEAT_INITIAL_DELAY_MS);
    const interval = window.setInterval(pingWhenVisible, AUTH_HEARTBEAT_INTERVAL_MS);
    window.addEventListener('focus', pingWhenVisible);
    document.addEventListener('visibilitychange', pingWhenVisible);

    return () => {
      cancelled = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      window.removeEventListener('focus', pingWhenVisible);
      document.removeEventListener('visibilitychange', pingWhenVisible);
    };
  }, [getToken, isLoaded, isSignedIn]);

  return null;
}

async function verifyCurrentAuth(
  getToken: () => Promise<string | null>,
  authSnapshotRef: AuthSnapshotRef,
): Promise<AuthStatus> {
  let sawAuthFailure = false;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const snapshot = authSnapshotRef.current;
    if (!snapshot.isLoaded) {
      await delay(AUTH_CHECK_SETTLE_DELAY_MS);
      continue;
    }
    if (!snapshot.isSignedIn) return 'signed-out';

    const response = await checkCurrentUser(getToken).catch(() => null);
    if (!response) return 'unknown';
    if (response.ok) return 'active';
    if (response.status !== 401 && response.status !== 403) return 'unknown';
    sawAuthFailure = true;
    if (attempt === 0) await delay(AUTH_CHECK_RETRY_DELAY_MS);
  }

  const snapshot = authSnapshotRef.current;
  if (snapshot.isLoaded && !snapshot.isSignedIn) return 'signed-out';
  return sawAuthFailure ? 'signed-out' : 'unknown';
}

async function checkCurrentUser(getToken: () => Promise<string | null>) {
  const token = await getTokenWithTimeout(getToken, AUTH_CHECK_TOKEN_TIMEOUT_MS);
  const headers = new Headers({ 'x-lumen-auth-check': '1' });
  if (token) headers.set('Authorization', `Bearer ${token}`);

  return fetch('/api/me', {
    cache: 'no-store',
    credentials: 'include',
    headers,
  });
}

async function getTokenWithTimeout(
  getToken: () => Promise<string | null>,
  timeoutMs: number,
): Promise<string | null> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<null>((resolve) => {
    timeout = setTimeout(() => resolve(null), timeoutMs);
  });

  try {
    return await Promise.race([getToken().catch(() => null), timeoutPromise]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function delay(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function AppProviders({
  children,
  enableApiAuthBridge = true,
  initialLocale,
}: {
  children: ReactNode;
  enableApiAuthBridge?: boolean;
  initialLocale?: Locale;
}) {
  const publishableKey = __LUMEN_CLERK_PUBLISHABLE_KEY__;

  if (!publishableKey) {
    return (
      <div className="flex min-h-dvh items-center justify-center px-6 text-center text-sm text-white/70">
        Missing Clerk publishable key.
      </div>
    );
  }

  return (
    <ClerkProvider
      publishableKey={publishableKey}
      localization={initialLocale === 'zh' ? (zhCN as never) : undefined}
      signInUrl={initialLocale === 'zh' ? '/zh/sign-in' : '/sign-in'}
      signUpUrl={initialLocale === 'zh' ? '/zh/sign-up' : '/sign-up'}
      afterSignOutUrl={initialLocale === 'zh' ? '/zh' : '/'}
      signInFallbackRedirectUrl="/app/home"
      signUpFallbackRedirectUrl="/app/home"
    >
      <I18nProvider initialLocale={initialLocale}>
        {enableApiAuthBridge && <ApiAuthBridge />}
        {children}
      </I18nProvider>
    </ClerkProvider>
  );
}
