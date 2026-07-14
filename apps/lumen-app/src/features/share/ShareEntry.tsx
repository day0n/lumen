import { ClerkAuthShell } from '@/components/auth/ClerkAuthShell';
import { LumenMark } from '@/components/ui/LumenMark';
import { SignIn, useAuth } from '@clerk/react';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/provider';
import { type Locale, localePath } from '../../i18n/routing';

const SHARE_ID_PATTERN = /^[0-9a-f]{32}$/;
const CLONE_TIMEOUT_MS = 15_000;

type FetchRequest = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

interface SharePreview {
  title: string;
}

interface ShareClone {
  projectId: string;
  created: boolean;
}

type ShareLoadState =
  | { status: 'loading' }
  | { status: 'not-found' }
  | { status: 'failed' }
  | { status: 'ready'; preview: SharePreview };

type ShareCloneState = 'cloning' | 'retryable-failure' | 'unauthorized' | 'fatal-failure';

interface ActiveCloneOperation {
  key: string;
}

interface CurrentAuthSnapshot {
  isSignedIn: boolean;
  sessionId: string | null | undefined;
  userId: string | null | undefined;
}

export class ShareRequestError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ShareRequestError';
  }
}

export function parseSharePathname(pathname: string): { locale: Locale; shareId: string } | null {
  const match = pathname.match(/^\/(?:zh\/)?share\/([0-9a-f]{32})\/?$/);
  if (!match?.[1]) return null;
  return {
    locale: pathname.startsWith('/zh/') ? 'zh' : 'en',
    shareId: match[1],
  };
}

export async function requestSharePreview(
  shareId: string,
  locale: Locale,
  request: FetchRequest = fetch,
  signal?: AbortSignal,
): Promise<SharePreview> {
  assertShareId(shareId);
  const response = await request(`/api/shares/${shareId}`, {
    credentials: 'omit',
    headers: { 'x-lumen-locale': locale },
    signal,
  });
  const payload = await readPayload(response);
  if (!response.ok) throw responseError(response, payload);
  const envelope = readRecord(payload);
  if (envelope?.ok !== true) {
    throw new ShareRequestError(502, 'Share preview response is invalid');
  }
  const preview = readRecord(envelope.data)?.preview;
  const title = readRecord(preview)?.title;
  if (typeof title !== 'string' || !title.trim()) {
    throw new ShareRequestError(502, 'Share preview response is invalid');
  }
  return { title };
}

export async function requestShareClone(
  shareId: string,
  token: string,
  locale: Locale,
  request: FetchRequest = fetch,
  signal?: AbortSignal,
): Promise<ShareClone> {
  assertShareId(shareId);
  if (!token.trim()) throw new ShareRequestError(401, 'A valid session is required');

  const response = await request(`/api/shares/${shareId}/clone`, {
    cache: 'no-store',
    credentials: 'omit',
    headers: {
      Authorization: `Bearer ${token}`,
      'x-lumen-locale': locale,
    },
    method: 'POST',
    signal,
  });
  const payload = await readPayload(response);
  if (!response.ok) throw responseError(response, payload);
  const envelope = readRecord(payload);
  if (envelope?.ok !== true) {
    throw new ShareRequestError(502, 'Share clone response is invalid');
  }
  const data = readRecord(envelope.data);
  const projectId = data?.projectId;
  if (!isSafeProjectId(projectId) || typeof data?.created !== 'boolean') {
    throw new ShareRequestError(502, 'Share clone response is invalid');
  }
  return { projectId, created: data.created };
}

export function ShareEntry() {
  const route = parseSharePathname(window.location.pathname);
  const shareId = route?.shareId;
  const { getToken, isLoaded, isSignedIn, sessionId, userId } = useAuth();
  const { locale, t } = useI18n();
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [cloneAttempt, setCloneAttempt] = useState(0);
  const [loadState, setLoadState] = useState<ShareLoadState>(
    route ? { status: 'loading' } : { status: 'not-found' },
  );
  const [cloneState, setCloneState] = useState<ShareCloneState>('cloning');
  const mountedRef = useRef(false);
  const activeCloneOperationRef = useRef<ActiveCloneOperation | null>(null);
  const currentAuthRef = useRef<CurrentAuthSnapshot>({
    isSignedIn: Boolean(isSignedIn),
    sessionId,
    userId,
  });
  const latestLoadAttemptRef = useRef(loadAttempt);
  currentAuthRef.current = {
    isSignedIn: Boolean(isSignedIn),
    sessionId,
    userId,
  };
  latestLoadAttemptRef.current = loadAttempt;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (isLoaded && isSignedIn && sessionId && userId) return;
    activeCloneOperationRef.current = null;
  }, [isLoaded, isSignedIn, sessionId, userId]);

  useEffect(() => {
    if (!shareId) return;
    const requestAttempt = loadAttempt;
    const controller = new AbortController();
    setLoadState({ status: 'loading' });
    void requestSharePreview(shareId, locale, fetch, controller.signal)
      .then((preview) => {
        if (requestAttempt !== latestLoadAttemptRef.current) return;
        document.title = `${preview.title} — Lumen`;
        setLoadState({ status: 'ready', preview });
      })
      .catch((error: unknown) => {
        if (controller.signal.aborted || requestAttempt !== latestLoadAttemptRef.current) return;
        setLoadState(
          error instanceof ShareRequestError && error.status === 404
            ? { status: 'not-found' }
            : { status: 'failed' },
        );
      });
    return () => controller.abort();
  }, [loadAttempt, locale, shareId]);

  useEffect(() => {
    if (
      !shareId ||
      loadState.status !== 'ready' ||
      !isLoaded ||
      !isSignedIn ||
      !sessionId ||
      !userId
    ) {
      return;
    }

    const operationKey = `${userId}:${sessionId}:${shareId}:${cloneAttempt}`;
    if (activeCloneOperationRef.current?.key === operationKey) return;
    const operation: ActiveCloneOperation = { key: operationKey };
    activeCloneOperationRef.current = operation;
    setCloneState('cloning');

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), CLONE_TIMEOUT_MS);

    void (async () => {
      try {
        const token = await waitForShareToken(getToken, controller.signal);
        const clone = await requestShareClone(
          shareId,
          token ?? '',
          locale,
          fetch,
          controller.signal,
        );
        if (!isCurrentCloneOperation(operation, userId, sessionId)) return;
        window.location.replace(`/app/canvas/${encodeURIComponent(clone.projectId)}`);
      } catch (error: unknown) {
        if (!isCurrentCloneOperation(operation, userId, sessionId)) return;
        activeCloneOperationRef.current = null;

        if (error instanceof ShareRequestError && error.status === 404) {
          setLoadState({ status: 'not-found' });
        } else if (
          error instanceof ShareRequestError &&
          (error.status === 401 || error.status === 403)
        ) {
          setCloneState('unauthorized');
        } else if (!(error instanceof ShareRequestError) || error.status >= 500) {
          setCloneState('retryable-failure');
        } else {
          setCloneState('fatal-failure');
        }
      } finally {
        window.clearTimeout(timeout);
      }
    })();

    function isCurrentCloneOperation(
      expectedOperation: ActiveCloneOperation,
      expectedUserId: string,
      expectedSessionId: string,
    ) {
      const currentAuth = currentAuthRef.current;
      return (
        mountedRef.current &&
        activeCloneOperationRef.current === expectedOperation &&
        currentAuth.isSignedIn &&
        currentAuth.userId === expectedUserId &&
        currentAuth.sessionId === expectedSessionId
      );
    }
  }, [cloneAttempt, getToken, isLoaded, isSignedIn, loadState, locale, sessionId, shareId, userId]);

  if (!route || loadState.status === 'not-found') {
    return <ShareStatus title={t('share.notFound')} />;
  }
  if (loadState.status === 'failed') {
    return (
      <ShareStatus
        title={t('share.loadFailed')}
        actionLabel={t('share.retry')}
        onAction={() => setLoadAttempt((attempt) => attempt + 1)}
      />
    );
  }
  if (loadState.status === 'loading' || !isLoaded) {
    return <ShareStatus title={t('share.loading')} busy />;
  }
  if (isSignedIn) {
    const sharePath = localePath(`/share/${route.shareId}`, locale);
    const signInPath = localePath('/sign-in', locale);
    const retryable = cloneState === 'retryable-failure';
    const unauthorized = cloneState === 'unauthorized';
    return (
      <ShareStatus
        projectTitle={loadState.preview.title}
        title={
          unauthorized
            ? t('share.sessionExpired')
            : cloneState === 'cloning'
              ? t('share.cloning')
              : t('share.cloneFailed')
        }
        busy={cloneState === 'cloning'}
        actionLabel={
          unauthorized ? t('share.signInAgain') : retryable ? t('share.retry') : undefined
        }
        onAction={
          unauthorized
            ? () => {
                window.location.assign(
                  `${signInPath}?redirect_url=${encodeURIComponent(sharePath)}`,
                );
              }
            : retryable
              ? () => {
                  setCloneState('cloning');
                  setCloneAttempt((attempt) => attempt + 1);
                }
              : undefined
        }
      />
    );
  }

  const sharePath = localePath(`/share/${route.shareId}`, locale);
  return (
    <ShareFrame projectTitle={loadState.preview.title}>
      <div className="rounded-[24px] bg-[#111315]/72 p-2 shadow-[0_28px_90px_rgba(0,0,0,0.5)] ring-1 ring-white/[0.1] backdrop-blur-2xl">
        <ClerkAuthShell>
          <SignIn
            fallbackRedirectUrl={sharePath}
            forceRedirectUrl={sharePath}
            routing="hash"
            signUpFallbackRedirectUrl={sharePath}
            signUpForceRedirectUrl={sharePath}
            signUpUrl={localePath('/sign-up', locale)}
          />
        </ClerkAuthShell>
      </div>
    </ShareFrame>
  );
}

function ShareStatus({
  actionLabel,
  busy = false,
  onAction,
  projectTitle,
  title,
}: {
  actionLabel?: string;
  busy?: boolean;
  onAction?: () => void;
  projectTitle?: string;
  title: string;
}) {
  return (
    <ShareFrame projectTitle={projectTitle}>
      <div className="flex min-h-28 w-full flex-col items-center justify-center gap-4 rounded-[22px] border border-white/[0.09] bg-[#111315]/78 px-6 py-8 text-center shadow-[0_28px_90px_rgba(0,0,0,0.45)] backdrop-blur-2xl">
        {busy && (
          <span
            aria-hidden
            className="h-6 w-6 animate-spin rounded-full border-2 border-white/15 border-t-white/80"
          />
        )}
        <p className="text-sm leading-6 text-white/70">{title}</p>
        {actionLabel && onAction && (
          <button
            type="button"
            onClick={onAction}
            className="inline-flex min-h-11 items-center justify-center rounded-full bg-white px-5 text-sm font-semibold text-black transition hover:bg-white/90"
          >
            {actionLabel}
          </button>
        )}
      </div>
    </ShareFrame>
  );
}

function ShareFrame({
  children,
  projectTitle,
}: { children: React.ReactNode; projectTitle?: string }) {
  const { t } = useI18n();
  return (
    <main className="relative flex min-h-dvh items-center justify-center overflow-hidden bg-[#050607] px-6 py-12 text-white">
      <div className="absolute inset-0 opacity-70 blur-[2px]">
        <div className="absolute left-[10%] top-[18%] h-[320px] w-[520px] rounded-[32px] border border-white/[0.12] bg-[#16191d]/80 shadow-[0_40px_140px_rgba(0,0,0,0.55)]" />
        <div className="absolute left-[24%] top-[28%] h-[150px] w-[270px] rounded-[16px] border border-white/[0.13] bg-[#202328]" />
        <div className="absolute left-[43%] top-[31%] h-[130px] w-[240px] rounded-[16px] border border-[#79e4ff]/28 bg-[#121821]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_34%,rgba(121,228,255,0.16),transparent_34%),radial-gradient(circle_at_74%_20%,rgba(214,255,156,0.1),transparent_26%)]" />
      </div>
      <div className="absolute inset-0 bg-black/50 backdrop-blur-md" />
      <div className="relative z-10 flex w-full max-w-[440px] flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <LumenMark size={42} />
          <div>
            <p className="text-[12px] font-bold uppercase tracking-[0.18em] text-white/38">
              {t('share.label')}
            </p>
            {projectTitle && (
              <h1 className="mt-2 max-w-[360px] truncate font-display text-[22px] font-black text-white">
                {projectTitle}
              </h1>
            )}
          </div>
        </div>
        {children}
      </div>
    </main>
  );
}

async function readPayload(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function responseError(response: Response, payload: unknown): ShareRequestError {
  const message = readRecord(readRecord(payload)?.error)?.message;
  return new ShareRequestError(
    response.status,
    typeof message === 'string' && message.trim()
      ? message
      : `Share request failed (${response.status})`,
  );
}

function readRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function isSafeProjectId(value: unknown): value is string {
  if (typeof value !== 'string' || !value.trim() || value.length > 128 || value !== value.trim()) {
    return false;
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (character === '\\' || character === '/' || code <= 31 || code === 127) return false;
  }
  return true;
}

function assertShareId(shareId: string) {
  if (!SHARE_ID_PATTERN.test(shareId)) {
    throw new ShareRequestError(400, 'Share ID is invalid');
  }
}

export async function waitForShareToken(
  getToken: () => Promise<string | null>,
  signal: AbortSignal,
): Promise<string | null> {
  if (signal.aborted) throw new Error('Share clone request timed out');

  let abortListener: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    abortListener = () => reject(new Error('Share clone request timed out'));
    signal.addEventListener('abort', abortListener, { once: true });
  });

  try {
    return await Promise.race([Promise.resolve().then(getToken), abortPromise]);
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
}
