import { ClerkLoaded, ClerkLoading } from '@clerk/react';
import { type ReactNode, useCallback, useEffect, useState } from 'react';
import type { AuthBoundaryCopy } from './auth-copy';

const AUTH_LOAD_TIMEOUT_MS = 15_000;

type FailureKind = 'network' | 'timeout';

export function ClerkAuthBoundary({
  backPath,
  children,
  copy,
}: {
  backPath: string;
  children: ReactNode;
  copy: AuthBoundaryCopy;
}) {
  const [failure, setFailure] = useState<FailureKind | null>(null);
  const [ready, setReady] = useState(false);

  const markReady = useCallback(() => {
    setReady(true);
    setFailure(null);
  }, []);

  useEffect(() => {
    if (ready) return;

    const timer = window.setTimeout(() => {
      setFailure((current) => current ?? 'timeout');
    }, AUTH_LOAD_TIMEOUT_MS);
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      if (isAuthServiceFailure(event.reason)) setFailure('network');
    };
    const onError = (event: ErrorEvent) => {
      if (isAuthServiceFailure(event.error ?? event.message)) setFailure('network');
    };

    window.addEventListener('unhandledrejection', onUnhandledRejection);
    window.addEventListener('error', onError);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('unhandledrejection', onUnhandledRejection);
      window.removeEventListener('error', onError);
    };
  }, [ready]);

  if (failure && !ready) {
    return (
      <AuthTroubleshootCard
        backPath={backPath}
        copy={copy}
        onRetry={() => window.location.reload()}
      />
    );
  }

  return (
    <div className="auth-boundary">
      <ClerkLoading>
        <AuthLoading copy={copy} />
      </ClerkLoading>
      <ClerkLoaded>
        <ReadyMarker onReady={markReady}>{children}</ReadyMarker>
      </ClerkLoaded>
    </div>
  );
}

export function isAuthServiceFailure(reason: unknown) {
  if (!reason) return false;
  const text = stringifyFailure(reason);
  return (
    text.includes('clerk.lumenstudio.tech') ||
    text.includes('ClerkJS') ||
    text.includes('clerk.browser.js') ||
    text.includes('The string did not match the expected pattern')
  );
}

function stringifyFailure(reason: unknown) {
  if (typeof reason === 'string') return reason;
  if (reason instanceof Error) return `${reason.name}: ${reason.message}\n${reason.stack ?? ''}`;
  try {
    return JSON.stringify(reason);
  } catch {
    return String(reason);
  }
}

function ReadyMarker({ children, onReady }: { children: ReactNode; onReady: () => void }) {
  useEffect(() => {
    onReady();
  }, [onReady]);
  return <>{children}</>;
}

function AuthLoading({ copy }: { copy: AuthBoundaryCopy }) {
  return (
    <output className="auth-loading" aria-live="polite">
      <span className="auth-spinner" aria-hidden />
      <span>{copy.loading}</span>
    </output>
  );
}

function AuthTroubleshootCard({
  backPath,
  copy,
  onRetry,
}: {
  backPath: string;
  copy: AuthBoundaryCopy;
  onRetry: () => void;
}) {
  return (
    <section className="auth-troubleshoot" aria-live="polite">
      <div className="auth-troubleshoot-heading">
        <span className="auth-warning-dot" aria-hidden />
        <div>
          <h1>{copy.timeoutTitle}</h1>
          <p>{copy.networkHint}</p>
        </div>
      </div>
      <ol>
        {copy.tips.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ol>
      <div className="auth-actions">
        <button type="button" onClick={onRetry}>
          {copy.retry}
        </button>
        <a href={backPath}>{copy.backHome}</a>
      </div>
    </section>
  );
}
