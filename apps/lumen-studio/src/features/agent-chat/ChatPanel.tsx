'use client';

/**
 * Canvas 右侧 Agent Chat。
 *
 * 这里保持界面很轻：提交后只显示用户消息、轻量 Thinking 状态和最终回复；
 * 详细 SSE event 仍在 hook 内维护，必要时再扩展为调试面板。
 */

import { MobileSheet } from '@/components/mobile';
import { LumenMark } from '@/components/ui/LumenMark';
import { VoiceInputControl } from '@/components/voice/VoiceInputControl';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { appendSpeechTranscript, useSpeechToText } from '@/hooks/use-speech-to-text';
import { useI18n } from '@/i18n/provider';
import { useLoginRedirect } from '@/lib/auth-redirect';
import { cn } from '@/lib/cn';
import { useAuth } from '@clerk/nextjs';
import {
  IconArrowUp,
  IconChevronDown,
  IconCopy,
  IconExternalLink,
  IconLoader2,
  IconMessages,
  IconPaperclip,
  IconPhoto,
  IconPlayerStopFilled,
  IconPlus,
  IconThumbDown,
  IconThumbUp,
  IconVideo,
  IconX,
} from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { nanoid } from 'nanoid';
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  type AgentChatStatus,
  type AgentSessionSummary,
  type ChatFeedback,
  type ChatMessage,
  type ChatTimelineItem,
  fetchAgentSessions,
  useAgentChat,
} from '@/features/agent-chat/use-agent-chat';

interface ChatPanelProps {
  projectId?: string;
  sessionId?: string;
  initialPrompt?: string | null;
  defaultOpen?: boolean;
  onWorkflowUpdate?: (data: Record<string, unknown>) => void | Promise<void>;
  onWorkflowNodeStatus?: (data: Record<string, unknown>) => void | Promise<void>;
}

interface ChatUploadAttachment {
  id: string;
  key?: string;
  url: string;
  name: string;
  contentType: string;
  size: number;
}

interface AgentChatUploadResponse {
  ok?: boolean;
  data?: {
    attachment?: Omit<ChatUploadAttachment, 'id'>;
  };
  error?: {
    message?: string;
  };
  message?: string;
}

const PANEL_MIN_WIDTH = 360;
const PANEL_MAX_WIDTH = 1100;
const PANEL_DEFAULT_WIDTH = 640;
const PANEL_WIDTH_STORAGE_KEY = 'lumen.agentChat.panelWidth';
const TOOL_TIMELINE_RECENT_LIMIT = 10;
const TOOL_TIMELINE_IMPORTANT_LIMIT = 8;
const IMPORTANT_TOOL_NAMES = new Set([
  'search_ad_videos',
  'find_inspiration',
  'search_my_materials',
  'search_web',
  'write_canvas',
]);

function clampPanelWidth(value: number): number {
  const viewportCap = typeof window !== 'undefined' ? window.innerWidth - 24 : PANEL_MAX_WIDTH;
  const max = Math.min(PANEL_MAX_WIDTH, viewportCap);
  return Math.max(PANEL_MIN_WIDTH, Math.min(max, value));
}

function clearInitialPromptFromUrl() {
  if (typeof window === 'undefined') return;
  const url = new URL(window.location.href);
  url.searchParams.delete('prompt');
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  window.history.replaceState(window.history.state, '', nextUrl);
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

export function ChatPanel({
  projectId,
  sessionId,
  initialPrompt,
  defaultOpen = false,
  onWorkflowUpdate,
  onWorkflowNodeStatus,
}: ChatPanelProps) {
  const isMobile = useIsMobile();
  const { locale, t } = useI18n();
  const { getToken } = useAuth();
  const [activeSessionId, setActiveSessionId] = useState(() => sessionId ?? createDraftSessionId());
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const sessionsRequestRef = useRef<{
    key: string;
    controller: AbortController;
    promise: Promise<AgentSessionSummary[]>;
  } | null>(null);
  const interactionStartedRef = useRef(false);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  const agentContext = useMemo(
    () => (projectId ? { project_id: projectId, workflow_id: projectId } : undefined),
    [projectId],
  );
  const shouldLoadActiveSessionHistory = useMemo(
    () =>
      Boolean(sessionId && sessionId === activeSessionId) ||
      sessions.some((item) => item.session_id === activeSessionId),
    [activeSessionId, sessionId, sessions],
  );
  const { messages, status, errorText, send, stop, setMessageFeedback } = useAgentChat({
    sessionId: activeSessionId,
    context: agentContext,
    locale,
    loadHistory: shouldLoadActiveSessionHistory,
    onWorkflowUpdate,
    onWorkflowNodeStatus,
  });
  const { isLoaded: authReady, isSignedIn, requireLogin } = useLoginRedirect();
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState('');
  const [attachments, setAttachments] = useState<ChatUploadAttachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const autoSentRef = useRef(false);
  const initialPromptRef = useRef(initialPrompt);
  initialPromptRef.current = initialPrompt;
  const busy = isBusy(status);

  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT_WIDTH);
  const [resizing, setResizing] = useState(false);
  const resizeStateRef = useRef<{ startX: number; startWidth: number } | null>(null);

  useEffect(() => {
    const stored = Number(window.localStorage.getItem(PANEL_WIDTH_STORAGE_KEY));
    if (Number.isFinite(stored) && stored > 0) {
      setPanelWidth(clampPanelWidth(stored));
    }
  }, []);

  useEffect(() => {
    const onResize = () => setPanelWidth((current) => clampPanelWidth(current));
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    if (defaultOpen) setOpen(true);
  }, [defaultOpen]);

  const handleResizeMove = useCallback((event: PointerEvent) => {
    const state = resizeStateRef.current;
    if (!state) return;
    // Dragging left (negative delta) widens the right-anchored panel.
    const next = clampPanelWidth(state.startWidth + (state.startX - event.clientX));
    setPanelWidth(next);
  }, []);

  const stopResize = useCallback(() => {
    resizeStateRef.current = null;
    setResizing(false);
    window.removeEventListener('pointermove', handleResizeMove);
    window.removeEventListener('pointerup', stopResize);
    setPanelWidth((current) => {
      window.localStorage.setItem(PANEL_WIDTH_STORAGE_KEY, String(Math.round(current)));
      return current;
    });
  }, [handleResizeMove]);

  const startResize = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      event.preventDefault();
      resizeStateRef.current = { startX: event.clientX, startWidth: panelWidth };
      setResizing(true);
      window.addEventListener('pointermove', handleResizeMove);
      window.addEventListener('pointerup', stopResize);
    },
    [panelWidth, handleResizeMove, stopResize],
  );

  useEffect(
    () => () => {
      window.removeEventListener('pointermove', handleResizeMove);
      window.removeEventListener('pointerup', stopResize);
    },
    [handleResizeMove, stopResize],
  );

  const fetchSessionsOnce = useCallback(async (): Promise<AgentSessionSummary[]> => {
    if (!projectId) return [];
    const token = await getToken().catch(() => null);
    const key = `${projectId}:${token ?? ''}`;
    const existing = sessionsRequestRef.current;
    if (existing?.key === key) return existing.promise;

    existing?.controller.abort();
    const controller = new AbortController();
    const promise = fetchAgentSessions({
      workflowId: projectId,
      token,
      signal: controller.signal,
    }).finally(() => {
      if (sessionsRequestRef.current?.promise === promise) {
        sessionsRequestRef.current = null;
      }
    });
    sessionsRequestRef.current = { key, controller, promise };
    return promise;
  }, [getToken, projectId]);

  useEffect(() => {
    const requestKeyPrefix = projectId ? `${projectId}:` : '';
    return () => {
      const request = sessionsRequestRef.current;
      if (!requestKeyPrefix || request?.key.startsWith(requestKeyPrefix)) {
        request?.controller.abort();
        sessionsRequestRef.current = null;
      }
    };
  }, [projectId]);

  const loadSessions = useCallback(
    async (opts: { autoSelectLatest?: boolean } = {}) => {
      if (!projectId || !authReady || !isSignedIn) {
        setSessions([]);
        return;
      }

      const controller = new AbortController();
      setSessionsLoading(true);
      try {
        const nextSessions = await fetchSessionsOnce();
        if (controller.signal.aborted) return;
        setSessions(nextSessions);
        if (opts.autoSelectLatest && !interactionStartedRef.current && nextSessions.length > 0) {
          setActiveSessionId(nextSessions[0]!.session_id);
        }
      } catch (err) {
        if (!controller.signal.aborted && !isAbortError(err)) {
          console.error('failed to load agent sessions', err);
        }
      } finally {
        if (!controller.signal.aborted) {
          setSessionsLoading(false);
        }
      }
    },
    [authReady, fetchSessionsOnce, isSignedIn, projectId],
  );

  useEffect(() => {
    interactionStartedRef.current = false;
    autoSentRef.current = false;
    const keepPendingPromptSession = Boolean(
      !sessionId && initialPromptRef.current?.trim() && !autoSentRef.current,
    );
    const draftSessionId =
      sessionId ?? (keepPendingPromptSession ? activeSessionIdRef.current : createDraftSessionId());
    setActiveSessionId(draftSessionId);
    setSessions([]);
    setSessionsOpen(false);
    setAttachments([]);
    setUploadError(null);

    if (!authReady || !isSignedIn || !projectId) return;
    const controller = new AbortController();
    setSessionsLoading(true);
    void fetchSessionsOnce()
      .then((nextSessions) => {
        if (controller.signal.aborted) return;
        setSessions(nextSessions);
        const shouldUseLatest = !initialPromptRef.current?.trim() && !interactionStartedRef.current;
        if (shouldUseLatest && nextSessions.length > 0) {
          setActiveSessionId(nextSessions[0]!.session_id);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted) return;
        if (isAbortError(err)) return;
        console.error('failed to load agent sessions', err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSessionsLoading(false);
      });

    return () => controller.abort();
  }, [authReady, fetchSessionsOnce, isSignedIn, projectId, sessionId]);

  useEffect(() => {
    if (autoSentRef.current || !authReady) return;
    if (!isSignedIn) {
      requireLogin();
      return;
    }
    if (!projectId) return;
    const trimmed = initialPrompt?.trim();
    if (!trimmed) return;
    autoSentRef.current = true;
    interactionStartedRef.current = true;
    setOpen(true);
    void send(trimmed).finally(() => {
      void loadSessions().finally(() => {
        clearInitialPromptFromUrl();
      });
    });
  }, [initialPrompt, projectId, send, authReady, isSignedIn, requireLogin, loadSessions]);

  const streamKey = useMemo(
    () =>
      messages
        .map(
          (message) =>
            `${message.id}:${message.content.length}:${message.thinking?.length ?? 0}:${
              message.events?.length ?? 0
            }:${message.status}`,
        )
        .join('|'),
    [messages],
  );

  useEffect(() => {
    if (!open) return;
    const el = scrollRef.current;
    if (!el) return;
    void streamKey;
    // While streaming, the user can be re-scheduled to the bottom dozens of
    // times per second. `behavior: 'smooth'` cannot keep up with that — each
    // call cancels the previous animation and restarts, so the scrollbar
    // looks jittery and never quite reaches the bottom. Use 'auto' (instant)
    // mid-stream and only smooth-scroll when the message has fully settled.
    // Also respect the user's intent: if they scrolled up to read history
    // (more than 80px from the bottom), don't yank them back.
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    const lastMessage = messages[messages.length - 1];
    const isStreaming = lastMessage?.status === 'streaming';
    if (distanceFromBottom > 80 && isStreaming) return;
    el.scrollTo({
      top: el.scrollHeight,
      behavior: isStreaming ? 'auto' : 'smooth',
    });
  }, [open, streamKey, messages]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    void draft;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 128)}px`;
  }, [draft]);

  const handleUploadImages = useCallback(
    async (files: FileList | File[]) => {
      const nextFiles = Array.from(files).filter((file) => file.type.startsWith('image/'));
      if (nextFiles.length === 0) {
        setUploadError(t('chat.chooseImages'));
        return;
      }
      if (!requireLogin()) return;

      setUploading(true);
      setUploadError(null);
      try {
        const uploaded = await Promise.all(
          nextFiles.map((file) => uploadAgentChatImage(file, projectId, locale)),
        );
        setAttachments((prev) => [...prev, ...uploaded].slice(-8));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setUploadError(message);
      } finally {
        setUploading(false);
      }
    },
    [locale, projectId, requireLogin, t],
  );

  const handleFileChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const files = event.currentTarget.files;
      if (files?.length) {
        void handleUploadImages(files);
      }
      event.currentTarget.value = '';
    },
    [handleUploadImages],
  );

  const removeAttachment = useCallback((attachmentId: string) => {
    setAttachments((prev) => prev.filter((item) => item.id !== attachmentId));
  }, []);

  const submit = () => {
    const text = draft.trim();
    if ((!text && attachments.length === 0) || busy || uploading) return;
    if (!requireLogin()) return;
    const outgoingMessage = buildMessageWithAttachments(text, attachments, t);
    interactionStartedRef.current = true;
    setDraft('');
    setAttachments([]);
    setUploadError(null);
    void send(outgoingMessage).finally(() => {
      void loadSessions();
    });
  };

  const startNewSession = () => {
    if (busy) return;
    interactionStartedRef.current = false;
    setSessionsOpen(false);
    setAttachments([]);
    setUploadError(null);
    setActiveSessionId(createDraftSessionId());
  };

  const selectSession = (nextSessionId: string) => {
    if (busy || nextSessionId === activeSessionIdRef.current) {
      setSessionsOpen(false);
      return;
    }
    interactionStartedRef.current = false;
    setSessionsOpen(false);
    setAttachments([]);
    setUploadError(null);
    setActiveSessionId(nextSessionId);
  };

  const currentSession = sessions.find((item) => item.session_id === activeSessionId);
  const title = currentSession ? formatSessionTitle(currentSession, t) : t('chat.newChat');

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    submit();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault();
      submit();
    }
  };

  const chatAside = (
    <motion.aside
      initial={isMobile ? { opacity: 0, y: 24 } : { opacity: 0, x: 34, filter: 'blur(6px)' }}
      animate={isMobile ? { opacity: 1, y: 0 } : { opacity: 1, x: 0, filter: 'blur(0px)' }}
      transition={resizing ? { duration: 0 } : { type: 'spring', stiffness: 260, damping: 30 }}
      className={cn(
        'relative flex h-full w-full flex-col overflow-hidden bg-[#151515] text-white',
        isMobile
          ? 'shadow-none'
          : 'border-l border-white/[0.08] shadow-[0_30px_100px_-52px_rgba(0,0,0,0.98)]',
      )}
    >
      <header className="relative z-10 flex min-h-[56px] shrink-0 items-center justify-between border-b border-white/[0.07] px-4 pt-[max(0px,env(safe-area-inset-top))] sm:px-5">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="min-w-0 truncate text-[14px] font-semibold leading-5 text-white/88">
            {title}
          </span>
          {busy ? <StatusRing busy compact /> : null}
        </div>

        <div className="flex items-center gap-1 text-white/50">
          <button
            type="button"
            onClick={startNewSession}
            disabled={busy}
            aria-label={t('chat.newChat')}
            title={t('chat.newChat')}
            className={cn(
              'flex min-h-11 min-w-11 items-center justify-center rounded-lg transition-colors',
              busy
                ? 'cursor-not-allowed text-white/24'
                : 'text-white/68 hover:bg-white/[0.07] hover:text-white',
            )}
          >
            <IconPlus size={18} stroke={2.2} />
          </button>
          <button
            type="button"
            onClick={() => setSessionsOpen((value) => !value)}
            aria-label={t('chat.history')}
            title={t('chat.history')}
            className={cn(
              'flex min-h-11 min-w-11 items-center justify-center rounded-lg transition-colors',
              sessionsOpen
                ? 'bg-white/[0.08] text-white'
                : 'hover:bg-white/[0.07] hover:text-white',
            )}
          >
            <IconMessages size={17} stroke={2.15} />
          </button>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label={t('common.close')}
            title={t('common.close')}
            className="flex min-h-11 min-w-11 items-center justify-center rounded-lg text-white/68 transition-colors hover:bg-white/[0.07] hover:text-white"
          >
            <IconX size={18} stroke={2.2} />
          </button>
        </div>
      </header>

      <AnimatePresence>
        {sessionsOpen && !isMobile ? (
          <SessionMenu
            activeSessionId={activeSessionId}
            busy={busy}
            loading={sessionsLoading}
            sessions={sessions}
            onNewSession={startNewSession}
            onSelectSession={selectSession}
          />
        ) : null}
      </AnimatePresence>

      <div
        ref={scrollRef}
        className="relative z-10 flex-1 overflow-y-auto px-5 pb-5 pt-5 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]"
      >
        {messages.length === 0 ? (
          <WelcomeMessage />
        ) : (
          <ul className="flex min-h-full flex-col gap-6">
            <AnimatePresence initial={false}>
              {messages.map((message) => (
                <MemoMessageItem
                  key={message.id}
                  message={message}
                  onFeedback={setMessageFeedback}
                />
              ))}
            </AnimatePresence>
          </ul>
        )}

        {errorText ? (
          <div className="mt-4 text-[13px] leading-6 text-[#ff9aa6]">{errorText}</div>
        ) : null}
      </div>

      <Composer
        attachments={attachments}
        busy={busy}
        draft={draft}
        fileInputRef={fileInputRef}
        mobile={isMobile}
        textareaRef={textareaRef}
        uploadError={uploadError}
        uploading={uploading}
        onDraftChange={setDraft}
        onFileChange={handleFileChange}
        onKeyDown={handleKeyDown}
        onRemoveAttachment={removeAttachment}
        onSubmit={handleSubmit}
        onStop={stop}
      />
    </motion.aside>
  );

  if (!open) {
    return (
      <div
        className={cn(
          'absolute z-40',
          isMobile
            ? 'bottom-[calc(5.75rem+env(safe-area-inset-bottom))] right-4'
            : 'bottom-5 right-5',
        )}
      >
        <motion.button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t('chat.openAgent')}
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 360, damping: 24 }}
          className="flex min-h-12 min-w-12 items-center justify-center"
        >
          <LumenOrb active={busy} />
        </motion.button>
      </div>
    );
  }

  if (isMobile) {
    return (
      <>
        <div className="fixed inset-0 z-[70] flex flex-col bg-[#151515] lg:hidden">{chatAside}</div>
        <MobileSheet
          open={sessionsOpen}
          onClose={() => setSessionsOpen(false)}
          title={t('chat.history')}
        >
          <SessionMenuList
            activeSessionId={activeSessionId}
            busy={busy}
            loading={sessionsLoading}
            sessions={sessions}
            onNewSession={() => {
              startNewSession();
              setSessionsOpen(false);
            }}
            onSelectSession={(id) => {
              selectSession(id);
              setSessionsOpen(false);
            }}
          />
        </MobileSheet>
      </>
    );
  }

  return (
    <div
      className="absolute inset-y-0 right-0 z-40 max-w-[calc(100vw_-_24px)]"
      style={{ width: panelWidth }}
    >
      <button
        type="button"
        aria-label={t('chat.resizePanel')}
        title={t('chat.resizePanel')}
        onPointerDown={startResize}
        onDoubleClick={() => setPanelWidth(clampPanelWidth(PANEL_DEFAULT_WIDTH))}
        className={cn(
          'group absolute inset-y-0 left-0 z-50 flex w-3 -translate-x-1/2 cursor-col-resize touch-none items-center justify-center',
          resizing ? '' : 'transition-opacity',
        )}
      >
        <span
          className={cn(
            'h-full w-[2px] rounded-full transition-colors',
            resizing ? 'bg-[#8ee7ff]' : 'bg-transparent group-hover:bg-[#8ee7ff]/55',
          )}
        />
      </button>
      {chatAside}
    </div>
  );
}

function SessionMenu({
  activeSessionId,
  busy,
  loading,
  sessions,
  onNewSession,
  onSelectSession,
}: {
  activeSessionId: string;
  busy: boolean;
  loading: boolean;
  sessions: AgentSessionSummary[];
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -6, scale: 0.985 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -6, scale: 0.985 }}
      transition={{ duration: 0.16, ease: [0.32, 0.72, 0, 1] }}
      className="absolute left-4 right-4 top-[56px] z-30 overflow-hidden rounded-[18px] border border-white/[0.14] bg-[#191a1c]/98 shadow-[0_24px_72px_-36px_rgba(0,0,0,0.92)] backdrop-blur-2xl"
    >
      <SessionMenuList
        activeSessionId={activeSessionId}
        busy={busy}
        loading={loading}
        sessions={sessions}
        onNewSession={onNewSession}
        onSelectSession={onSelectSession}
      />
    </motion.div>
  );
}

function SessionMenuList({
  activeSessionId,
  busy,
  loading,
  sessions,
  onNewSession,
  onSelectSession,
}: {
  activeSessionId: string;
  busy: boolean;
  loading: boolean;
  sessions: AgentSessionSummary[];
  onNewSession: () => void;
  onSelectSession: (sessionId: string) => void;
}) {
  const { locale, t } = useI18n();
  return (
    <>
      <div className="border-b border-white/[0.08] p-2">
        <button
          type="button"
          onClick={onNewSession}
          disabled={busy}
          className={cn(
            'flex h-10 w-full items-center gap-2 rounded-[12px] px-3 text-left text-[13px] font-semibold transition-colors',
            busy
              ? 'cursor-not-allowed text-white/28'
              : 'text-white/86 hover:bg-white/[0.07] hover:text-white',
          )}
        >
          <IconPlus size={17} stroke={2.4} />
          <span className="min-w-0 truncate">{t('chat.newChat')}</span>
        </button>
      </div>

      <div className="max-h-[236px] overflow-y-auto p-2 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]">
        {loading ? (
          <div className="flex h-14 items-center gap-2 px-3 text-[12px] font-medium text-white/40">
            <IconLoader2 size={14} className="animate-spin" stroke={2.4} />
            <span>{t('common.loading')}...</span>
          </div>
        ) : null}

        {!loading && sessions.length === 0 ? (
          <div className="px-3 py-4 text-[12px] font-medium text-white/34">
            {t('chat.noHistory')}
          </div>
        ) : null}

        {sessions.map((session) => {
          const active = session.session_id === activeSessionId;
          return (
            <button
              key={session.session_id}
              type="button"
              onClick={() => onSelectSession(session.session_id)}
              disabled={busy}
              className={cn(
                'flex w-full min-w-0 items-center gap-3 rounded-[12px] px-3 py-2.5 text-left transition-colors',
                active
                  ? 'bg-white/[0.09] text-white'
                  : 'text-white/70 hover:bg-white/[0.055] hover:text-white',
                busy && !active ? 'cursor-not-allowed opacity-50' : '',
              )}
            >
              <span
                className={cn(
                  'h-2 w-2 shrink-0 rounded-full',
                  active ? 'bg-[#79e4ff]' : 'bg-white/22',
                )}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-semibold leading-5">
                  {formatSessionTitle(session, t)}
                </span>
                <span className="mt-0.5 block truncate text-[11px] leading-4 text-white/34">
                  {formatSessionTime(session.updated_at, locale)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </>
  );
}

function createDraftSessionId(): string {
  return `studio-${nanoid(12)}`;
}

function formatSessionTitle(
  session: AgentSessionSummary,
  t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string,
): string {
  const summary = session.summary?.trim();
  if (summary) return summary;
  const preview = session.last_message_preview?.trim();
  if (preview) return preview.length > 42 ? `${preview.slice(0, 39)}...` : preview;
  return t('chat.untitledChat');
}

function formatSessionTime(value: string | undefined, locale: 'en' | 'zh'): string {
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const diffMs = Date.now() - timestamp;
  const formatter = new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    numeric: 'auto',
  });
  if (diffMs < 60_000) return formatter.format(0, 'second');
  if (diffMs < 3_600_000)
    return formatter.format(-Math.max(1, Math.floor(diffMs / 60_000)), 'minute');
  if (diffMs < 86_400_000)
    return formatter.format(-Math.max(1, Math.floor(diffMs / 3_600_000)), 'hour');
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  }).format(new Date(timestamp));
}

function buildMessageWithAttachments(
  text: string,
  attachments: ChatUploadAttachment[],
  t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string,
): string {
  if (attachments.length === 0) return text;

  const intro = text.trim() || t('chat.imageIntro');
  const lines = attachments.map((item, index) => {
    const label = item.name.trim() || `image-${index + 1}`;
    return `${index + 1}. ${label}: ${item.url}`;
  });
  return `${intro}\n\n${t('chat.uploadedImages')}\n${lines.join('\n')}`;
}

async function uploadAgentChatImage(
  file: File,
  workflowId: string | undefined,
  locale: 'en' | 'zh',
): Promise<ChatUploadAttachment> {
  const form = new FormData();
  form.set('file', file);
  if (workflowId) form.set('workflowId', workflowId);

  const response = await fetch('/api/agent-chat/uploads', {
    method: 'POST',
    headers: { 'x-lumen-locale': locale },
    body: form,
  });
  const rawText = await response.text().catch(() => '');
  const payload = parseUploadResponse(rawText);
  if (!response.ok) {
    throw new Error(readUploadError(payload) ?? (rawText || `HTTP ${response.status}`));
  }

  const attachment = payload?.data?.attachment;
  if (!attachment?.url) {
    throw new Error(
      locale === 'zh' ? '上传响应缺少图片地址' : 'Upload response is missing the image URL',
    );
  }

  return {
    id: nanoid(),
    key: attachment.key,
    url: attachment.url,
    name: attachment.name || file.name || 'image',
    contentType: attachment.contentType || file.type || 'image/*',
    size: attachment.size || file.size,
  };
}

function parseUploadResponse(rawText: string): AgentChatUploadResponse | null {
  if (!rawText.trim()) return null;
  try {
    return JSON.parse(rawText) as AgentChatUploadResponse;
  } catch {
    return null;
  }
}

function readUploadError(payload: AgentChatUploadResponse | null): string | null {
  if (!payload) return null;
  return payload.error?.message ?? payload.message ?? null;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 KB';
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / 1024 / 1024).toFixed(bytes < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 1000) return `${Math.max(0, Math.round(ms))}ms`;
  return `${(ms / 1000).toFixed(ms < 10_000 ? 1 : 0)}s`;
}

function LumenOrb({ active }: { active: boolean }) {
  return (
    <span className="relative flex h-10 w-10 items-center justify-center">
      <span className="absolute inset-[-8px] rounded-[32%] bg-[#79e4ff]/16 blur-xl" />
      <motion.span
        className="absolute inset-[-5px] rounded-[32%] bg-[#79e4ff]/10 blur-md"
        animate={
          active
            ? {
                opacity: [0.45, 0.9, 0.45],
                scale: [0.92, 1.12, 0.92],
              }
            : { opacity: 0.52, scale: 1 }
        }
        transition={{ duration: 1.6, repeat: active ? Number.POSITIVE_INFINITY : 0 }}
      />
      <LumenMark
        size={38}
        className="relative z-10 drop-shadow-[0_0_18px_rgba(121,228,255,0.55)]"
      />
    </span>
  );
}

function StatusRing({ busy, compact = false }: { busy: boolean; compact?: boolean }) {
  return (
    <span
      className={cn(
        'relative flex shrink-0 items-center justify-center',
        compact ? 'h-[18px] w-[18px]' : 'h-5 w-5',
      )}
    >
      <span className="absolute inset-0 rounded-full border border-white/34" />
      {busy ? (
        <motion.span
          className="absolute inset-0 rounded-full border border-transparent border-t-[#79e4ff]"
          animate={{ rotate: 360 }}
          transition={{ duration: 1.1, repeat: Number.POSITIVE_INFINITY, ease: 'linear' }}
        />
      ) : null}
    </span>
  );
}

function WelcomeMessage() {
  const { t } = useI18n();
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
      className="mt-auto pb-3"
    >
      <div className="max-w-[90%] text-[14px] font-medium leading-6 text-white/72">
        {t('chat.welcome')}
      </div>
    </motion.div>
  );
}

type MessageFeedbackHandler = (params: {
  messageId: string;
  runId?: string;
  turn?: number;
  feedback: ChatFeedback | null;
  previousFeedback?: ChatFeedback | null;
}) => Promise<void>;

function MessageItem({
  message,
  onFeedback,
}: {
  message: ChatMessage;
  onFeedback: MessageFeedbackHandler;
}) {
  return message.role === 'user' ? (
    <UserMessage message={message} />
  ) : (
    <AssistantMessage message={message} onFeedback={onFeedback} />
  );
}

// SSE token deltas mutate `message.content` ~10-30 times per second on the
// last assistant message. Without memo the parent's `messages.map` re-runs
// every other message's render too, and each <AssistantMessage> calls
// parseRichMessageContent (a markdown regex sweep) inside its render body.
// Memoising on message reference + onFeedback keeps untouched messages
// stable; useAgentChat does an immutable update on the streaming message
// only, so its reference flip is what we *want* to re-render.
const MemoMessageItem = memo(MessageItem, (prev, next) => {
  return prev.message === next.message && prev.onFeedback === next.onFeedback;
});

function UserMessage({ message }: { message: ChatMessage }) {
  // parseRichMessageContent walks the full content with markdown regex and
  // builds an attachment Map; cache by content reference so it only re-runs
  // when the actual text changes (user messages are immutable in practice
  // but cheap to be safe).
  const richContent = useMemo(() => parseRichMessageContent(message.content), [message.content]);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      className="flex justify-end"
    >
      <div className="max-w-[72%] rounded-[16px] bg-[#323335] px-3.5 py-2.5 text-[14px] font-medium leading-6 text-white shadow-[0_12px_32px_-24px_rgba(0,0,0,0.85)]">
        <RichMessageText blocks={richContent.blocks} />
        <MediaPreviewList media={richContent.media} />
      </div>
    </motion.li>
  );
}

function AssistantMessage({
  message,
  onFeedback,
}: {
  message: ChatMessage;
  onFeedback: MessageFeedbackHandler;
}) {
  const { t } = useI18n();
  const isStreaming = message.status === 'streaming';
  const isFailed = message.status === 'failed';
  const liveLabel = getLiveLabel(message, t);
  // Same parser as UserMessage. Streaming assistants tick `content` once per
  // SSE delta; with memo on MessageItem only the actively-streaming message
  // re-renders, but inside that single render we still want the parse cached
  // — RichMessageText/MediaPreviewList do their own work on the result.
  const richContent = useMemo(() => parseRichMessageContent(message.content), [message.content]);
  const hasActivity = hasToolActivity(message.events);
  const thinkingLabel = thinkingSummaryLabel(message, t);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      className="flex items-start"
    >
      <div className="min-w-0 flex-1">
        {isStreaming && !hasActivity ? <ThinkingLine label={liveLabel} /> : null}
        <Timeline items={message.events} />
        {message.content ? (
          <div
            className={cn(
              'max-w-[92%] text-[14px] font-medium leading-6 text-white/72',
              hasActivity ? 'mt-4' : '',
            )}
          >
            <RichMessageText blocks={richContent.blocks} />
            {isStreaming ? <StreamingCaret /> : null}
            <MediaPreviewList media={richContent.media} />
          </div>
        ) : null}
        {message.content && !isStreaming && !isFailed ? (
          <MessageActions message={message} onFeedback={onFeedback} />
        ) : null}

        {isFailed ? (
          <div className="mt-3 text-[14px] font-medium leading-6 text-[#ff9aa6]">
            {message.error ?? t('chat.failed')}
          </div>
        ) : null}

        {message.thinking?.trim() && !isStreaming ? (
          <details className="mt-3 max-w-[92%] text-[14px] font-medium leading-6 text-white/42">
            <summary className="cursor-pointer list-none marker:hidden">{thinkingLabel}</summary>
            <div className="mt-1 whitespace-pre-wrap break-words leading-6">
              {message.thinking.trim()}
            </div>
          </details>
        ) : null}
      </div>
    </motion.li>
  );
}

type InlineNode =
  | { kind: 'text'; text: string }
  | { kind: 'bold'; text: string }
  | { kind: 'link'; text: string; href: string }
  | { kind: 'image'; alt: string; src: string };

interface MarkdownBlock {
  type: 'heading' | 'paragraph';
  level: number;
  inlines: InlineNode[];
}

interface MediaAttachment {
  type: 'image' | 'video' | 'audio';
  url: string;
  label: string;
  hideLabel?: boolean;
}

interface InspirationCardItem {
  title: string;
  description: string;
  url: string;
  thumbnailUrl: string;
  category: string;
  tags: string[];
  score: number | null;
}

interface AdVideoCardItem {
  id: string;
  platform: string;
  landingUrl: string;
  videoUrl: string;
  thumbnailUrl: string;
  headline: string;
  brand: string;
  durationSec: number | null;
  activeDays: number | null;
}

const MESSAGE_URL_PATTERN =
  /(?:https?:\/\/|www\.|(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\/)[^\s<>"'`[\]{}]*/gi;
const URL_TRAILING_PUNCTUATION_PATTERN = /[),.;!?，。；：！？）】》]+$/u;

function RichMessageText({ blocks }: { blocks: MarkdownBlock[] }) {
  return (
    <div className="space-y-2">
      {blocks.map((block, blockIndex) => {
        const inlines = renderInlines(block.inlines, blockIndex);
        const blockKey = `${block.type}-${blockIndex}-${inlineKeyHint(block.inlines)}`;
        if (block.type === 'heading') {
          return (
            <div
              key={blockKey}
              className={cn(
                'text-[14px] font-medium leading-6 text-white/78',
                blockIndex > 0 ? 'mt-1' : '',
              )}
            >
              {inlines}
            </div>
          );
        }
        return (
          <div key={blockKey} className="whitespace-pre-wrap break-words">
            {inlines}
          </div>
        );
      })}
    </div>
  );
}

function inlineKeyHint(nodes: InlineNode[]): string {
  const first = nodes[0];
  if (!first) return 'empty';
  if (first.kind === 'image') return first.src.slice(-16);
  if (first.kind === 'link') return first.href.slice(-16);
  return first.text.slice(0, 16);
}

function renderInlines(nodes: InlineNode[], blockIndex: number) {
  return nodes.map((node, index) => {
    const key = `${blockIndex}-${index}`;
    if (node.kind === 'image') {
      return (
        <a
          key={key}
          href={node.src}
          target="_blank"
          rel="noreferrer"
          className="my-2 block overflow-hidden rounded-lg border border-white/[0.12] bg-black/35"
        >
          <img
            src={node.src}
            alt={node.alt}
            loading="lazy"
            className="max-h-[280px] w-full object-contain"
          />
        </a>
      );
    }
    if (node.kind === 'link') {
      return (
        <a
          key={key}
          href={node.href}
          target="_blank"
          rel="noreferrer"
          className="break-all text-[#8ee7ff] underline decoration-[#8ee7ff]/35 underline-offset-4 transition-colors hover:text-white"
        >
          {node.text}
        </a>
      );
    }
    if (node.kind === 'bold') {
      return (
        <strong key={key} className="font-medium text-white/82">
          {node.text}
        </strong>
      );
    }
    return <span key={key}>{node.text}</span>;
  });
}

function MediaPreviewList({ media }: { media: MediaAttachment[] }) {
  const { t } = useI18n();
  if (media.length === 0) return null;

  return (
    <div className="mt-3 space-y-3">
      {media.map((item) => (
        <div
          key={`${item.type}-${item.url}`}
          className="overflow-hidden rounded-lg border border-white/[0.12] bg-black/35"
        >
          {item.type === 'image' ? (
            <a href={item.url} target="_blank" rel="noreferrer" className="block">
              <img
                src={item.url}
                alt={item.label}
                loading="lazy"
                className="max-h-[280px] w-full object-contain"
              />
            </a>
          ) : null}

          {item.type === 'video' ? (
            /* biome-ignore lint/a11y/useMediaCaption: Agent-generated video assets do not include caption tracks yet. */
            <video
              src={item.url}
              controls
              playsInline
              preload="metadata"
              className="max-h-[300px] w-full bg-black"
            >
              {t('chat.browserVideoUnsupported')}
            </video>
          ) : null}

          {item.type === 'audio' ? (
            <div className="px-3 py-3">
              {/* biome-ignore lint/a11y/useMediaCaption: Agent-generated audio assets do not include caption tracks yet. */}
              <audio src={item.url} controls preload="metadata" className="w-full" />
            </div>
          ) : null}

          {!item.hideLabel ? (
            <a
              href={item.url}
              target="_blank"
              rel="noreferrer"
              className="block truncate border-t border-white/[0.08] px-3 py-2 text-[14px] font-medium leading-6 text-white/54 transition-colors hover:text-white/82"
            >
              {item.label}
            </a>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function AdVideoResultList({
  compact = false,
  items,
}: {
  compact?: boolean;
  items: AdVideoCardItem[];
}) {
  const { locale } = useI18n();
  if (items.length === 0) return null;

  const title = locale === 'zh' ? '找到的广告参考' : 'Ad references';
  const openLabel = locale === 'zh' ? '打开视频' : 'Open video';

  return (
    <div className={compact ? 'mt-3' : 'mt-4 max-w-[94%]'}>
      <div className="mb-2 flex items-center gap-2 text-[14px] font-medium leading-6 text-white/58">
        <IconVideo size={15} stroke={2.2} className="text-[#8ee7ff]/78" />
        <span>{title}</span>
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const href = item.videoUrl || item.landingUrl;
          const meta = [
            item.platform,
            item.durationSec !== null ? `${Math.round(item.durationSec)}s` : null,
            item.activeDays !== null
              ? locale === 'zh'
                ? `投放 ${item.activeDays} 天`
                : `${item.activeDays} active days`
              : null,
          ].filter(Boolean);

          return (
            <a
              key={item.videoUrl || item.landingUrl || item.id}
              href={href}
              target="_blank"
              rel="noreferrer"
              className="group grid grid-cols-[72px_minmax(0,1fr)] overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.045] transition-colors hover:border-white/[0.2] hover:bg-white/[0.07]"
            >
              <div className="aspect-video h-full min-h-[72px] bg-black/34">
                {item.thumbnailUrl ? (
                  <img
                    src={item.thumbnailUrl}
                    alt={item.headline || item.brand || title}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-white/34">
                    <IconVideo size={18} stroke={2.2} />
                  </div>
                )}
              </div>
              <div className="min-w-0 px-2.5 py-2">
                <div className="flex min-w-0 items-center gap-1.5">
                  <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-6 text-white/78">
                    {item.brand || item.headline || title}
                  </span>
                  <IconExternalLink size={12} stroke={2.2} className="shrink-0 text-white/34" />
                </div>
                {item.headline ? (
                  <div className="line-clamp-2 text-[14px] font-medium leading-5 text-white/48">
                    {item.headline}
                  </div>
                ) : null}
                {meta.length > 0 ? (
                  <div className="mt-0.5 truncate text-[14px] font-medium leading-6 text-white/34">
                    {meta.join(' · ')}
                  </div>
                ) : null}
                <div className="sr-only">{openLabel}</div>
              </div>
            </a>
          );
        })}
      </div>
    </div>
  );
}

function InspirationResultGrid({
  compact = false,
  items,
}: {
  compact?: boolean;
  items: InspirationCardItem[];
}) {
  const { locale } = useI18n();
  if (items.length === 0) return null;

  const title = locale === 'zh' ? '找到的灵感图' : 'Inspiration references';
  const openLabel = locale === 'zh' ? '打开原图' : 'Open image';

  return (
    <div className={compact ? 'mt-3' : 'mt-4 max-w-[94%]'}>
      <div className="mb-2 flex items-center gap-2 text-[14px] font-medium leading-6 text-white/58">
        <IconPhoto size={15} stroke={2.2} className="text-[#8ee7ff]/78" />
        <span>{title}</span>
      </div>
      <div className={cn('grid gap-2.5', compact ? 'grid-cols-2' : 'grid-cols-2 sm:grid-cols-3')}>
        {items.map((item, index) => (
          <a
            key={item.url}
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className={cn(
              'group overflow-hidden rounded-lg border border-white/[0.08] bg-white/[0.045] transition-colors hover:border-white/[0.2] hover:bg-white/[0.07]',
              !compact && (index === 0 || index === 3) ? 'sm:col-span-2' : '',
            )}
          >
            <div
              className={cn(
                'bg-black/30',
                !compact && (index === 0 || index === 3) ? 'aspect-[16/9]' : 'aspect-[4/3]',
              )}
            >
              <img
                src={item.thumbnailUrl}
                alt={item.title}
                loading="lazy"
                className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.025]"
              />
            </div>
            <div className="min-w-0 px-2.5 py-2">
              <div className="flex min-w-0 items-center gap-1.5">
                <span className="min-w-0 flex-1 truncate text-[14px] font-medium leading-6 text-white/78">
                  {item.title}
                </span>
                <IconExternalLink size={12} stroke={2.2} className="shrink-0 text-white/34" />
              </div>
              <div className="mt-0.5 truncate text-[14px] font-medium leading-6 text-white/38">
                {[item.category, ...item.tags.slice(0, 2)].filter(Boolean).join(' · ')}
              </div>
              <div className="sr-only">{openLabel}</div>
            </div>
          </a>
        ))}
      </div>
    </div>
  );
}

function hasToolActivity(items?: ChatTimelineItem[]): boolean {
  return (items ?? []).some(
    (item) => item.kind === 'tool' || item.kind === 'act_event' || item.kind === 'error',
  );
}

function Timeline({ items }: { items?: ChatTimelineItem[] }) {
  const runs = selectVisibleToolActivityRuns(buildToolActivityRuns(items));
  const errors = (items ?? [])
    .filter((item) => item.kind === 'error' && !item.toolCallId)
    .slice(-3);

  if (runs.length === 0 && errors.length === 0) return null;

  return (
    <div className="mt-1 max-w-[94%]">
      <div className="space-y-2 border-l border-white/[0.095] pl-3">
        {runs.map((run) => (
          <ToolActivityItem key={run.id} run={run} />
        ))}
        {errors.map((item) => (
          <TimelineStandaloneItem key={item.id} item={item} />
        ))}
      </div>
    </div>
  );
}

interface ToolActivityRun {
  id: string;
  createdAt: number;
  status: ChatTimelineItem['status'];
  root?: ChatTimelineItem;
  events: ChatTimelineItem[];
}

type TimelineTranslator = (
  key: string,
  params?: Record<string, string | number | boolean | null | undefined>,
) => string;

function ToolActivityItem({ run }: { run: ToolActivityRun }) {
  const { t } = useI18n();
  const title = toolRunTitle(run, t);
  const detail = toolRunDetail(run);
  const inspirationItems = extractInspirationResults(run.events);
  const adVideoItems = extractAdVideoResults(run.events);
  const visibleEvents = run.events.filter(
    (event) => !['ad_video_results', 'inspiration_results'].includes(event.eventName ?? ''),
  );
  const hasDetails =
    Boolean(detail) ||
    visibleEvents.length > 0 ||
    inspirationItems.length > 0 ||
    adVideoItems.length > 0;
  const defaultOpen =
    run.status === 'running' ||
    inspirationItems.length > 0 ||
    adVideoItems.length > 0 ||
    run.status === 'error';
  const inlineStatus = toolRunInlineStatus(run.status, t);

  return (
    <details open={defaultOpen} className="group text-[14px] font-medium leading-6 text-white/46">
      <summary className="-ml-[19px] flex min-w-0 cursor-pointer list-none items-center gap-2 py-1.5 pr-1 outline-none transition-colors hover:text-white/72 [&::-webkit-details-marker]:hidden">
        <TimelineDot status={run.status} />
        <span className="min-w-0 flex-1 truncate text-white/68">{title}</span>
        {run.root?.durationMs ? (
          <span className="shrink-0 text-white/34">{formatDuration(run.root.durationMs)}</span>
        ) : null}
        {inlineStatus ? (
          <span className={cn('shrink-0', inlineStatus.className)}>{inlineStatus.label}</span>
        ) : null}
        {hasDetails ? (
          <IconChevronDown
            size={14}
            stroke={2.2}
            className="shrink-0 text-white/24 transition-transform group-open:rotate-180"
          />
        ) : null}
      </summary>

      {hasDetails ? (
        <div className="pb-2 pl-3">
          {detail ? <div className="mb-1 min-w-0 break-words text-white/42">{detail}</div> : null}
          {visibleEvents.length > 0 ? (
            <div className="space-y-1">
              {visibleEvents.slice(-5).map((event) => (
                <ToolEventRow key={event.id} item={event} />
              ))}
            </div>
          ) : null}
          <AdVideoResultList items={adVideoItems} compact />
          <InspirationResultGrid items={inspirationItems} compact />
        </div>
      ) : null}
    </details>
  );
}

function ToolEventRow({ item }: { item: ChatTimelineItem }) {
  const progress = readProgress(item.payload?.progress);

  return (
    <div className="py-1">
      <div className="flex min-w-0 items-center gap-2">
        <span
          className={cn(
            'h-1.5 w-1.5 shrink-0 rounded-full',
            item.status === 'running'
              ? 'bg-[#79e4ff]'
              : item.status === 'success'
                ? 'bg-[#7ee787]'
                : item.status === 'error'
                  ? 'bg-[#ff7b8a]'
                  : item.status === 'cancelled'
                    ? 'bg-white/42'
                    : 'bg-white/30',
          )}
        />
        <span className="min-w-0 flex-1 truncate text-white/48">{item.title}</span>
      </div>
      {item.detail ? (
        <div className="mt-0.5 min-w-0 truncate pl-3.5 text-white/34">{item.detail}</div>
      ) : null}
      {progress !== null && item.status === 'running' ? (
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.07]">
          <div
            className="h-full rounded-full bg-[#79e4ff]/75 transition-all duration-300"
            style={{ width: `${Math.max(8, Math.round(progress * 100))}%` }}
          />
        </div>
      ) : null}
    </div>
  );
}

function TimelineStandaloneItem({
  item,
}: {
  item: ChatTimelineItem;
}) {
  const { t } = useI18n();
  const inlineStatus = toolRunInlineStatus(item.status, t);
  const title = timelineItemTitle(item, t);

  return (
    <div className="-ml-[19px] pb-2">
      <div className="flex min-w-0 items-center gap-2 py-1.5 pr-1">
        <TimelineDot status={item.status} />
        <span className="min-w-0 flex-1 truncate text-white/68">{title}</span>
        {inlineStatus ? (
          <span className={cn('shrink-0', inlineStatus.className)}>{inlineStatus.label}</span>
        ) : null}
      </div>
      {item.detail ? <div className="pl-8 text-white/38">{item.detail}</div> : null}
    </div>
  );
}

function buildToolActivityRuns(items: ChatTimelineItem[] | undefined): ToolActivityRun[] {
  const runs = new Map<string, ToolActivityRun>();

  const ensureRun = (id: string, createdAt: number): ToolActivityRun => {
    const existing = runs.get(id);
    if (existing) return existing;
    const run: ToolActivityRun = {
      id,
      createdAt,
      status: 'info',
      events: [],
    };
    runs.set(id, run);
    return run;
  };

  for (const item of items ?? []) {
    if (item.kind !== 'tool' && item.kind !== 'act_event') continue;
    const id = item.toolCallId ?? parseToolCallId(item);
    if (!id) continue;
    const run = ensureRun(id, item.createdAt);
    if (item.kind === 'tool') {
      run.root = item;
      run.createdAt = Math.min(run.createdAt, item.createdAt);
    } else {
      const index = run.events.findIndex((event) => event.id === item.id);
      if (index === -1) run.events.push(item);
      else run.events[index] = item;
    }
    run.status = deriveToolRunStatus(run);
  }

  return [...runs.values()].sort((a, b) => a.createdAt - b.createdAt);
}

function selectVisibleToolActivityRuns(runs: ToolActivityRun[]): ToolActivityRun[] {
  const recent = runs.slice(-TOOL_TIMELINE_RECENT_LIMIT);
  const important = runs.filter(isImportantToolRun).slice(-TOOL_TIMELINE_IMPORTANT_LIMIT);
  const visibleIds = new Set([...important, ...recent].map((run) => run.id));
  return runs.filter((run) => visibleIds.has(run.id));
}

function isImportantToolRun(run: ToolActivityRun): boolean {
  const toolName = toolRunToolName(run);
  if (toolName && IMPORTANT_TOOL_NAMES.has(toolName)) return true;
  return run.events.some((event) =>
    ['ad_video_results', 'inspiration_results', 'material_results'].includes(event.eventName ?? ''),
  );
}

function deriveToolRunStatus(run: ToolActivityRun): ChatTimelineItem['status'] {
  if (run.root?.status === 'error' || run.events.some((event) => event.status === 'error')) {
    return 'error';
  }
  if (
    run.root?.status === 'cancelled' ||
    run.events.some((event) => event.status === 'cancelled')
  ) {
    return 'cancelled';
  }
  if (
    run.root?.status === 'running' ||
    run.root?.status === 'queued' ||
    run.events.some((event) => event.status === 'running' || event.status === 'queued')
  ) {
    return 'running';
  }
  if (run.root?.status === 'success' || run.events.some((event) => event.status === 'success')) {
    return 'success';
  }
  return run.root?.status ?? run.events.at(-1)?.status ?? 'info';
}

function toolRunTitle(run: ToolActivityRun, t: TimelineTranslator): string {
  const toolName = toolRunToolName(run);
  if (toolName) {
    const label = formatTimelineToolName(toolName, t);
    if (run.status === 'success') return t('chat.timeline.toolDone', { tool: label });
    if (run.status === 'error') return t('chat.timeline.toolFailed', { tool: label });
    if (run.status === 'cancelled') return t('chat.timeline.toolCancelled', { tool: label });
    return label;
  }

  if (run.status === 'running' && run.root?.title) return run.root.title;
  const event =
    [...run.events].reverse().find((item) => item.status !== 'info') ?? run.events.at(-1);
  return event?.title ?? run.root?.title ?? run.root?.toolName ?? 'Tool';
}

function timelineItemTitle(item: ChatTimelineItem, t: TimelineTranslator): string {
  if (item.kind === 'error') return t('chat.timeline.taskFailed');
  if (item.kind === 'thinking') {
    return item.status === 'running'
      ? t('chat.timeline.thinkingRunning')
      : t('chat.timeline.thinkingSaved');
  }
  return item.title;
}

function thinkingSummaryLabel(message: ChatMessage, t: TimelineTranslator): string {
  const durationMs = message.events
    ?.filter((event) => event.kind === 'step' && event.status === 'success' && event.durationMs)
    .at(-1)?.durationMs;
  if (!durationMs) return t('chat.thinkingDetails');
  return t('chat.timeline.thinkingElapsed', {
    seconds: Math.max(1, Math.round(durationMs / 1000)),
  });
}

function toolRunToolName(run: ToolActivityRun): string | undefined {
  return run.root?.toolName ?? run.events.find((event) => event.toolName)?.toolName;
}

function formatTimelineToolName(toolName: string, t: TimelineTranslator): string {
  const key = `chat.timeline.tools.${toolName}`;
  const label = t(key);
  if (label !== key) return label;
  return toolName.replace(/[_-]+/g, ' ').replace(/\b\w/g, (character) => character.toUpperCase());
}

function toolRunDetail(run: ToolActivityRun): string | undefined {
  if (run.status === 'running') return run.root?.detail;
  const event = [...run.events].reverse().find((item) => item.detail);
  return event?.detail ?? run.root?.detail;
}

function parseToolCallId(item: ChatTimelineItem): string | null {
  if (item.id.startsWith('tool.event.')) {
    return item.id.split('.')[2] ?? null;
  }
  if (item.id.startsWith('tool.')) return item.id.slice('tool.'.length) || null;
  return null;
}

function toolRunInlineStatus(
  status: ChatTimelineItem['status'],
  t: TimelineTranslator,
): { label: string; className: string } | null {
  if (status === 'running' || status === 'queued') {
    return { label: t('chat.timeline.statusRunning'), className: 'text-[#79e4ff]/72' };
  }
  return null;
}

function TimelineDot({ status }: { status: ChatTimelineItem['status'] }) {
  return (
    <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center bg-[#151515]">
      <span
        className={cn(
          'h-1.5 w-1.5 rounded-full',
          status === 'running' || status === 'queued'
            ? 'bg-[#79e4ff]'
            : status === 'error'
              ? 'bg-[#ff7b8a]'
              : status === 'success'
                ? 'bg-[#7ee787]'
                : status === 'cancelled'
                  ? 'bg-white/42'
                  : 'bg-white/28',
        )}
      />
    </span>
  );
}

function MessageActions({
  message,
  onFeedback,
}: {
  message: ChatMessage;
  onFeedback: MessageFeedbackHandler;
}) {
  const { t } = useI18n();
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle');
  const [savingFeedback, setSavingFeedback] = useState<ChatFeedback | null>(null);
  const canPersistFeedback = Boolean(message.runId || typeof message.turn === 'number');

  const copyMessage = async () => {
    try {
      await copyTextToClipboard(message.content);
      setCopyState('copied');
      window.setTimeout(() => setCopyState('idle'), 1400);
    } catch {
      setCopyState('error');
      window.setTimeout(() => setCopyState('idle'), 1800);
    }
  };

  const updateFeedback = async (feedback: ChatFeedback) => {
    if (!canPersistFeedback || savingFeedback) return;
    const previousFeedback = message.feedback ?? null;
    const nextFeedback = previousFeedback === feedback ? null : feedback;
    setSavingFeedback(feedback);
    try {
      await onFeedback({
        messageId: message.id,
        runId: message.runId,
        turn: message.turn,
        feedback: nextFeedback,
        previousFeedback,
      });
    } catch {
      // The hook rolls the optimistic state back. Keep the action quiet.
    } finally {
      setSavingFeedback(null);
    }
  };

  return (
    <div className="mt-5 flex items-center gap-4 text-white/46">
      <button
        type="button"
        onClick={() => {
          void copyMessage();
        }}
        aria-label={copyState === 'copied' ? t('chat.actions.copied') : t('chat.actions.copy')}
        title={copyState === 'error' ? t('chat.actions.copyFailed') : t('chat.actions.copy')}
        className={cn(
          'transition-colors hover:text-white/78',
          copyState === 'copied' ? 'text-[#7ee787]' : '',
          copyState === 'error' ? 'text-[#ff9aa6]' : '',
        )}
      >
        <IconCopy size={18} stroke={2.1} />
      </button>
      <button
        type="button"
        onClick={() => {
          void updateFeedback('like');
        }}
        disabled={!canPersistFeedback || Boolean(savingFeedback)}
        aria-pressed={message.feedback === 'like'}
        aria-label={t('chat.actions.like')}
        title={t('chat.actions.like')}
        className={cn(
          'transition-colors hover:text-white/78 disabled:cursor-not-allowed disabled:opacity-38',
          message.feedback === 'like' ? 'text-[#7ee787]' : '',
        )}
      >
        <IconThumbUp size={18} stroke={message.feedback === 'like' ? 2.5 : 2.1} />
      </button>
      <button
        type="button"
        onClick={() => {
          void updateFeedback('dislike');
        }}
        disabled={!canPersistFeedback || Boolean(savingFeedback)}
        aria-pressed={message.feedback === 'dislike'}
        aria-label={t('chat.actions.dislike')}
        title={t('chat.actions.dislike')}
        className={cn(
          'transition-colors hover:text-white/78 disabled:cursor-not-allowed disabled:opacity-38',
          message.feedback === 'dislike' ? 'text-[#ff9aa6]' : '',
        )}
      >
        <IconThumbDown size={18} stroke={message.feedback === 'dislike' ? 2.5 : 2.1} />
      </button>
    </div>
  );
}

async function copyTextToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.left = '-9999px';
  document.body.appendChild(textarea);
  textarea.select();
  const ok = document.execCommand('copy');
  textarea.remove();
  if (!ok) throw new Error('copy failed');
}

function ThinkingLine({ label }: { label: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-4 inline-flex items-center gap-2 text-[14px] font-medium leading-6 text-white/46"
    >
      <span>{label}</span>
      <IconLoader2 size={13} className="animate-spin text-[#79e4ff]/70" stroke={2.4} />
    </motion.div>
  );
}

function StreamingCaret() {
  return (
    <motion.span
      className="ml-0.5 inline-block h-[14px] w-[2px] translate-y-[2px] rounded-sm bg-current"
      animate={{ opacity: [1, 0.2, 1] }}
      transition={{ duration: 0.95, repeat: Number.POSITIVE_INFINITY, ease: 'easeInOut' }}
    />
  );
}

function extractInspirationResults(events?: ChatTimelineItem[]): InspirationCardItem[] {
  const byUrl = new Map<string, InspirationCardItem>();
  for (const event of events ?? []) {
    if (event.eventName !== 'inspiration_results') continue;
    const results = Array.isArray(event.payload?.results) ? event.payload.results : [];
    for (const raw of results) {
      const item = parseInspirationItem(raw);
      if (item) byUrl.set(item.url, item);
    }
  }
  return [...byUrl.values()].slice(0, 12);
}

function extractAdVideoResults(events?: ChatTimelineItem[]): AdVideoCardItem[] {
  const byKey = new Map<string, AdVideoCardItem>();
  for (const event of events ?? []) {
    if (event.eventName !== 'ad_video_results') continue;
    const results = Array.isArray(event.payload?.results) ? event.payload.results : [];
    for (const raw of results) {
      const item = parseAdVideoItem(raw);
      if (!item) continue;
      byKey.set(item.videoUrl || item.landingUrl || item.id, item);
    }
  }
  return [...byKey.values()].slice(0, 8);
}

function parseInspirationItem(raw: unknown): InspirationCardItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const url = readText(data.url);
  if (!url) return null;
  const title = readText(data.title) ?? 'Inspiration';
  return {
    title,
    description: readText(data.description) ?? '',
    url,
    thumbnailUrl: readText(data.thumbnail_url) ?? url,
    category: readText(data.category) ?? '',
    tags: Array.isArray(data.tags)
      ? data.tags.map((tag) => readText(tag)).filter((tag): tag is string => Boolean(tag))
      : [],
    score: typeof data.score === 'number' ? data.score : null,
  };
}

function parseAdVideoItem(raw: unknown): AdVideoCardItem | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const data = raw as Record<string, unknown>;
  const videoUrl = readText(data.video_url) ?? readText(data.videoUrl) ?? '';
  const landingUrl = readText(data.landing_url) ?? readText(data.landingUrl) ?? '';
  if (!videoUrl && !landingUrl) return null;
  const id = readText(data.id) ?? (videoUrl || landingUrl);
  return {
    id,
    platform: readText(data.platform) ?? '',
    landingUrl,
    videoUrl,
    thumbnailUrl: readText(data.thumbnail_url) ?? readText(data.thumbnailUrl) ?? '',
    headline: readText(data.headline) ?? '',
    brand: readText(data.brand) ?? '',
    durationSec: readFiniteNumber(data.duration_sec ?? data.durationSec),
    activeDays: readFiniteNumber(data.active_days ?? data.activeDays),
  };
}

function readText(value: unknown): string | null {
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : null;
}

function readFiniteNumber(value: unknown): number | null {
  const numberValue =
    typeof value === 'number' ? value : typeof value === 'string' ? Number(value) : Number.NaN;
  return Number.isFinite(numberValue) ? numberValue : null;
}

function readProgress(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(1, value));
}

function Composer({
  attachments,
  busy,
  draft,
  fileInputRef,
  mobile = false,
  textareaRef,
  uploadError,
  uploading,
  onDraftChange,
  onFileChange,
  onKeyDown,
  onRemoveAttachment,
  onSubmit,
  onStop,
}: {
  attachments: ChatUploadAttachment[];
  busy: boolean;
  draft: string;
  fileInputRef: RefObject<HTMLInputElement | null>;
  mobile?: boolean;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  uploadError: string | null;
  uploading: boolean;
  onDraftChange: (value: string) => void;
  onFileChange: (event: ChangeEvent<HTMLInputElement>) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onRemoveAttachment: (attachmentId: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
}) {
  const { locale, t } = useI18n();
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const {
    listening,
    supported,
    error: speechError,
    toggle,
    cancel,
  } = useSpeechToText({
    language: locale === 'zh' ? 'zh-CN' : 'en-US',
    errors: {
      micPermission: t('home.micPermission'),
      noSpeech: t('home.noSpeech'),
      speechFailed: t('home.speechFailed'),
    },
    onTranscript: (chunk) => {
      onDraftChange(appendSpeechTranscript(draftRef.current, chunk));
    },
  });
  const canSend = Boolean(draft.trim()) || attachments.length > 0;

  return (
    <form
      onSubmit={onSubmit}
      className={cn(
        'relative z-10 shrink-0 px-2.5 pt-2',
        mobile ? 'pb-[max(12px,env(safe-area-inset-bottom))]' : 'pb-3',
      )}
    >
      <div
        className={cn(
          'agent-composer-star rounded-[20px] p-px',
          busy ? 'agent-composer-star-active' : '',
        )}
      >
        <div
          className={cn(
            'relative z-10 rounded-[18px] border border-white/[0.08] bg-[#202020] px-3 py-3 shadow-[0_18px_60px_-46px_rgba(0,0,0,0.92)] transition-colors focus-within:border-white/[0.16]',
            busy ? 'border-white/[0.14]' : '',
          )}
        >
          {attachments.length > 0 ? (
            <AttachmentStrip attachments={attachments} onRemoveAttachment={onRemoveAttachment} />
          ) : null}

          {uploadError ? (
            <div className="mb-2 rounded-lg border border-[#ff7b8a]/18 bg-[#ff7b8a]/8 px-2.5 py-1.5 text-[12px] leading-5 text-[#ffb6bf]">
              {uploadError}
            </div>
          ) : null}

          <div className="mb-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || uploading}
              aria-label={uploading ? t('chat.uploading') : t('chat.uploadImages')}
              title={uploading ? t('chat.uploading') : t('chat.uploadImages')}
              className={cn(
                'flex min-h-11 min-w-11 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.045] transition-colors',
                busy || uploading
                  ? 'cursor-not-allowed text-white/24'
                  : 'text-white/56 hover:bg-white/[0.08] hover:text-white',
              )}
            >
              {uploading ? (
                <IconLoader2 size={18} className="animate-spin" stroke={2.2} />
              ) : (
                <IconPaperclip size={17} stroke={2.1} />
              )}
            </button>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || uploading}
              aria-label={t('chat.uploadImages')}
              title={t('chat.uploadImages')}
              className={cn(
                'flex min-h-11 min-w-11 items-center justify-center rounded-[10px] border border-white/[0.08] bg-white/[0.045] transition-colors',
                busy || uploading
                  ? 'cursor-not-allowed text-white/24'
                  : 'text-white/56 hover:bg-white/[0.08] hover:text-white',
              )}
            >
              <IconPhoto size={17} stroke={2.1} />
            </button>
          </div>

          <div className="min-h-[72px]">
            <textarea
              ref={textareaRef}
              value={draft}
              onChange={(event) => onDraftChange(event.target.value)}
              onKeyDown={onKeyDown}
              placeholder={t('chat.placeholder')}
              rows={3}
              className="max-h-[128px] min-h-[72px] w-full resize-none bg-transparent text-[14px] leading-6 text-white outline-none placeholder:text-white/32"
            />
          </div>

          <div className="mt-2 flex items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={busy || uploading}
              aria-label={uploading ? t('chat.uploading') : t('chat.uploadImages')}
              title={uploading ? t('chat.uploading') : t('chat.uploadImages')}
              className={cn(
                'flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
                busy || uploading
                  ? 'cursor-not-allowed text-white/24'
                  : 'text-white/62 hover:bg-white/[0.07] hover:text-white',
              )}
            >
              <IconPlus size={21} stroke={2.1} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={onFileChange}
            />
            <div className="flex items-center gap-2">
              <VoiceInputControl
                listening={listening}
                supported={supported}
                error={speechError}
                disabled={busy || uploading}
                variant="composer"
                labels={{
                  voiceInput: t('home.voiceInput'),
                  voiceStop: t('home.voiceStop'),
                  voiceUnsupported: t('home.voiceUnsupported'),
                  voiceCancel: t('home.voiceCancel'),
                }}
                onToggle={toggle}
                onCancel={cancel}
              />
              <SendOrStopButton
                busy={busy}
                canSend={canSend}
                disabled={uploading}
                onStop={onStop}
              />
            </div>
          </div>
        </div>
      </div>
    </form>
  );
}

function AttachmentStrip({
  attachments,
  onRemoveAttachment,
}: {
  attachments: ChatUploadAttachment[];
  onRemoveAttachment: (attachmentId: string) => void;
}) {
  const { t } = useI18n();
  return (
    <div className="mb-3 flex gap-2 overflow-x-auto pb-1 [-webkit-overflow-scrolling:touch]">
      {attachments.map((item) => (
        <div
          key={item.id}
          className="group relative flex h-14 min-w-[160px] max-w-[210px] shrink-0 items-center gap-2 rounded-[12px] border border-white/[0.12] bg-white/[0.045] p-1.5 pr-7"
        >
          <img
            src={item.url}
            alt={item.name}
            className="h-11 w-11 shrink-0 rounded-lg object-cover"
            loading="lazy"
          />
          <span className="min-w-0">
            <span className="block truncate text-[12px] font-semibold leading-4 text-white/78">
              {item.name}
            </span>
            <span className="mt-0.5 block text-[11px] leading-4 text-white/34">
              {formatBytes(item.size)}
            </span>
          </span>
          <button
            type="button"
            onClick={() => onRemoveAttachment(item.id)}
            aria-label={t('chat.removeImage')}
            title={t('chat.removeImage')}
            className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-black/48 text-white/62 transition-colors hover:bg-black/70 hover:text-white"
          >
            <IconX size={13} stroke={2.6} />
          </button>
        </div>
      ))}
    </div>
  );
}

function SendOrStopButton({
  busy,
  canSend,
  disabled = false,
  onStop,
}: {
  busy: boolean;
  canSend: boolean;
  disabled?: boolean;
  onStop: () => void;
}) {
  const { t } = useI18n();
  if (busy) {
    return (
      <button
        type="button"
        onClick={onStop}
        aria-label={t('chat.stop')}
        title={t('chat.stop')}
        className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full bg-white text-[#111315] shadow-[0_12px_30px_-18px_rgba(255,255,255,0.82)] transition-transform active:scale-[0.96]"
      >
        <IconPlayerStopFilled size={14} />
      </button>
    );
  }

  return (
    <button
      type="submit"
      disabled={!canSend || disabled}
      aria-label={t('chat.send')}
      title={t('chat.send')}
      className={cn(
        'flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full transition-all',
        canSend && !disabled
          ? 'bg-white text-[#111315] shadow-[0_12px_30px_-18px_rgba(255,255,255,0.82)] hover:brightness-95 active:scale-[0.96]'
          : 'bg-white/[0.07] text-white/28 ring-1 ring-white/[0.06]',
      )}
    >
      <IconArrowUp size={17} stroke={2.8} />
    </button>
  );
}

function parseRichMessageContent(content: string): {
  blocks: MarkdownBlock[];
  media: MediaAttachment[];
} {
  const media = new Map<string, MediaAttachment>();
  const visibleContent = stripUploadedImageSection(content, media);
  const blocks: MarkdownBlock[] = [];
  let paragraph: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join('\n').trim();
    paragraph = [];
    if (!text) return;
    blocks.push({ type: 'paragraph', level: 0, inlines: parseInlineMarkdown(text, media) });
  };

  for (const rawLine of visibleContent.split('\n')) {
    const trimmed = rawLine.trim();
    const heading = /^(#{1,6})\s+(.*\S)\s*$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push({
        type: 'heading',
        level: heading[1]!.length,
        inlines: parseInlineMarkdown(heading[2]!, media),
      });
      continue;
    }
    if (trimmed === '') {
      flushParagraph();
      continue;
    }
    paragraph.push(rawLine);
  }
  flushParagraph();

  return { blocks, media: [...media.values()] };
}

function stripUploadedImageSection(content: string, media: Map<string, MediaAttachment>): string {
  const lines = content.split('\n');
  const kept: string[] = [];
  let inUploadedImages = false;

  for (const line of lines) {
    if (isUploadedImagesHeading(line)) {
      inUploadedImages = true;
      continue;
    }

    if (inUploadedImages) {
      const attachment = parseUploadedImageLine(line);
      if (attachment) {
        addMediaAttachment(media, attachment.url, attachment.label, { hideLabel: true });
        continue;
      }

      if (line.trim() === '') {
        continue;
      }

      inUploadedImages = false;
    }

    kept.push(line);
  }

  return kept.join('\n').trim();
}

function isUploadedImagesHeading(line: string): boolean {
  const normalized = line
    .trim()
    .replace(/[：:]\s*$/, '')
    .toLowerCase();
  return normalized === 'uploaded images' || normalized === '上传图片';
}

function parseUploadedImageLine(line: string): { url: string; label: string } | null {
  const found = findFirstMessageUrl(line);
  if (!found) return null;

  const label = line
    .slice(0, found.index)
    .replace(/^\s*(?:[-*]\s*)?(?:\d+[.)]\s*)?/, '')
    .replace(/\s*[：:]\s*$/, '')
    .trim();
  return { url: found.url, label: label || 'image' };
}

// Inline markdown: image ![alt](url), link [label](url), bold **text**, and bare URLs.
function parseInlineMarkdown(text: string, media: Map<string, MediaAttachment>): InlineNode[] {
  const nodes: InlineNode[] = [];
  const pattern = /(!?)\[([^\]\n]*)\]\(([^)]+)\)|\*\*([^*\n]+)\*\*/g;
  let cursor = 0;

  for (const match of text.matchAll(pattern)) {
    const start = match.index ?? 0;
    if (start > cursor) {
      appendTextWithBareLinks(text.slice(cursor, start), nodes, media);
    }

    if (match[4] !== undefined) {
      nodes.push({ kind: 'bold', text: match[4] });
    } else {
      const isImage = match[1] === '!';
      const label = match[2]?.trim() ?? '';
      const url = normalizeMessageUrl(match[3] ?? '');
      if (url && isImage) {
        nodes.push({ kind: 'image', alt: label || 'image', src: url });
      } else if (url) {
        const linkText = label || shortenUrl(url);
        nodes.push({ kind: 'link', text: linkText, href: url });
        addMediaAttachment(media, url, linkText);
      } else {
        nodes.push({ kind: 'text', text: match[0] });
      }
    }
    cursor = start + match[0].length;
  }

  if (cursor < text.length) {
    appendTextWithBareLinks(text.slice(cursor), nodes, media);
  }
  return nodes;
}

function appendTextWithBareLinks(
  text: string,
  nodes: InlineNode[],
  media: Map<string, MediaAttachment>,
) {
  if (!text) return;
  let cursor = 0;

  MESSAGE_URL_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(MESSAGE_URL_PATTERN)) {
    const matchStart = match.index ?? 0;
    if (matchStart > cursor) {
      nodes.push({ kind: 'text', text: text.slice(cursor, matchStart) });
    }

    const candidate = trimUrlCandidate(match[0]);
    const url = normalizeMessageUrl(candidate.value);
    if (url) {
      const label = shortenUrl(url);
      nodes.push({ kind: 'link', text: label, href: url });
      addMediaAttachment(media, url, label);
      if (candidate.trailing) nodes.push({ kind: 'text', text: candidate.trailing });
    } else {
      nodes.push({ kind: 'text', text: match[0] });
    }
    cursor = matchStart + match[0].length;
  }

  if (cursor < text.length) {
    nodes.push({ kind: 'text', text: text.slice(cursor) });
  }
}

function addMediaAttachment(
  media: Map<string, MediaAttachment>,
  url: string,
  label: string,
  options: { hideLabel?: boolean } = {},
) {
  const existing = media.get(url);
  if (existing) {
    if (options.hideLabel && !existing.hideLabel) {
      media.set(url, { ...existing, hideLabel: true });
    }
    return;
  }
  const type = detectMediaType(url);
  if (!type) return;
  media.set(url, { type, url, label, hideLabel: options.hideLabel });
}

function detectMediaType(url: string): MediaAttachment['type'] | null {
  let pathname = url;
  try {
    pathname = new URL(url).pathname;
  } catch {
    /* keep the original value */
  }
  const normalized = pathname.toLowerCase();
  if (/\.(png|jpe?g|webp|gif|avif)$/.test(normalized)) return 'image';
  if (/\.(mp4|webm|mov|m4v)$/.test(normalized)) return 'video';
  if (/\.(mp3|wav|m4a|aac|ogg)$/.test(normalized)) return 'audio';
  return null;
}

function findFirstMessageUrl(text: string): { url: string; index: number } | null {
  MESSAGE_URL_PATTERN.lastIndex = 0;
  for (const match of text.matchAll(MESSAGE_URL_PATTERN)) {
    const candidate = trimUrlCandidate(match[0]);
    const url = normalizeMessageUrl(candidate.value);
    if (url) return { url, index: match.index ?? 0 };
  }
  return null;
}

function trimUrlCandidate(raw: string): { value: string; trailing: string } {
  let value = raw.trim();
  let trailing = '';
  while (URL_TRAILING_PUNCTUATION_PATTERN.test(value)) {
    const next = value.replace(URL_TRAILING_PUNCTUATION_PATTERN, '');
    trailing = value.slice(next.length) + trailing;
    value = next;
  }
  return { value, trailing };
}

function normalizeMessageUrl(raw: string): string | null {
  const compact = trimUrlCandidate(raw).value.replace(/\s+/g, '');
  const withProtocol = /^https?:\/\//i.test(compact)
    ? compact
    : isProtocolLessMessageUrl(compact)
      ? `https://${compact}`
      : '';
  if (!withProtocol) return null;
  try {
    const parsed = new URL(withProtocol);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

function isProtocolLessMessageUrl(value: string): boolean {
  return /^(?:www\.|(?:[a-z0-9-]+\.)+[a-z]{2,}(?::\d+)?\/)[^\s<>"'`[\]{}]*$/i.test(value);
}

function shortenUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const fileName = parsed.pathname.split('/').filter(Boolean).at(-1);
    return fileName ? `${parsed.hostname}/${fileName}` : parsed.hostname;
  } catch {
    return url.length > 72 ? `${url.slice(0, 69)}...` : url;
  }
}

function getLiveLabel(
  message: ChatMessage,
  t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string,
): string {
  const current = message.events?.findLast?.((event) => event.status === 'running');
  if (!current) return t('chat.thinking');
  if (current.kind === 'tool') {
    return current.toolName
      ? t('chat.timeline.callTool', { tool: formatTimelineToolName(current.toolName, t) })
      : current.title;
  }
  if (current.kind === 'step') return t('chat.thinking');
  if (current.kind === 'thinking') return t('chat.timeline.thinkingRunning');
  return timelineItemTitle(current, t);
}

function isBusy(status: AgentChatStatus): boolean {
  return status === 'creating' || status === 'streaming' || status === 'reconnecting';
}
