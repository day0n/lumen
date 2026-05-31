'use client';

/**
 * Canvas 右侧 Agent Chat。
 *
 * 这里保持界面很轻：提交后只显示用户消息、轻量 Thinking 状态和最终回复；
 * 详细 SSE event 仍在 hook 内维护，必要时再扩展为调试面板。
 */

import { LumenMark } from '@/components/ui/LumenMark';
import { useLoginRedirect } from '@/lib/auth-redirect';
import { cn } from '@/lib/cn';
import { useAuth } from '@clerk/nextjs';
import {
  IconActivity,
  IconAlertCircle,
  IconArrowUp,
  IconBrain,
  IconCheck,
  IconChevronDown,
  IconCircleDot,
  IconCopy,
  IconGitBranch,
  IconLoader2,
  IconMinus,
  IconPlayerStopFilled,
  IconPlus,
  IconThumbDown,
  IconThumbUp,
  IconTool,
  IconX,
} from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { nanoid } from 'nanoid';
import { usePathname, useRouter } from 'next/navigation';
import {
  type ChangeEvent,
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import {
  type AgentChatStatus,
  type AgentSessionSummary,
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

export function ChatPanel({
  projectId,
  sessionId,
  initialPrompt,
  defaultOpen = false,
  onWorkflowUpdate,
  onWorkflowNodeStatus,
}: ChatPanelProps) {
  const { getToken } = useAuth();
  const [activeSessionId, setActiveSessionId] = useState(() => sessionId ?? createDraftSessionId());
  const [sessions, setSessions] = useState<AgentSessionSummary[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsOpen, setSessionsOpen] = useState(false);
  const interactionStartedRef = useRef(false);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;

  const agentContext = useMemo(
    () => (projectId ? { project_id: projectId, workflow_id: projectId } : undefined),
    [projectId],
  );
  const { messages, status, errorText, send, stop } = useAgentChat({
    sessionId: activeSessionId,
    context: agentContext,
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
  const router = useRouter();
  const pathname = usePathname();
  const busy = isBusy(status);

  const loadSessions = useCallback(
    async (opts: { autoSelectLatest?: boolean } = {}) => {
      if (!projectId || !authReady || !isSignedIn) {
        setSessions([]);
        return;
      }

      const controller = new AbortController();
      setSessionsLoading(true);
      try {
        const token = await getToken().catch(() => null);
        const nextSessions = await fetchAgentSessions({
          workflowId: projectId,
          token,
          signal: controller.signal,
        });
        if (controller.signal.aborted) return;
        setSessions(nextSessions);
        if (opts.autoSelectLatest && !interactionStartedRef.current && nextSessions.length > 0) {
          setActiveSessionId(nextSessions[0]!.session_id);
        }
      } catch (err) {
        if (!controller.signal.aborted) {
          console.error('failed to load agent sessions', err);
        }
      } finally {
        if (!controller.signal.aborted) {
          setSessionsLoading(false);
        }
      }
    },
    [authReady, getToken, isSignedIn, projectId],
  );

  useEffect(() => {
    interactionStartedRef.current = false;
    autoSentRef.current = false;
    const draftSessionId = sessionId ?? createDraftSessionId();
    setActiveSessionId(draftSessionId);
    setSessions([]);
    setSessionsOpen(false);
    setAttachments([]);
    setUploadError(null);

    if (!authReady || !isSignedIn || !projectId) return;
    const controller = new AbortController();
    setSessionsLoading(true);
    void getToken()
      .catch(() => null)
      .then((token) =>
        fetchAgentSessions({
          workflowId: projectId,
          token,
          signal: controller.signal,
        }),
      )
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
        console.error('failed to load agent sessions', err);
      })
      .finally(() => {
        if (!controller.signal.aborted) setSessionsLoading(false);
      });

    return () => controller.abort();
  }, [authReady, getToken, isSignedIn, projectId, sessionId]);

  useEffect(() => {
    if (autoSentRef.current || !authReady) return;
    if (!isSignedIn) {
      requireLogin();
      return;
    }
    const trimmed = initialPrompt?.trim();
    if (!trimmed) return;
    autoSentRef.current = true;
    interactionStartedRef.current = true;
    setOpen(true);
    void send(trimmed).finally(() => {
      void loadSessions();
    });
    router.replace(pathname, { scroll: false });
  }, [initialPrompt, send, router, pathname, authReady, isSignedIn, requireLogin, loadSessions]);

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
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [open, streamKey]);

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
        setUploadError('请选择图片文件');
        return;
      }
      if (!requireLogin()) return;

      setUploading(true);
      setUploadError(null);
      try {
        const uploaded = await Promise.all(
          nextFiles.map((file) => uploadAgentChatImage(file, projectId)),
        );
        setAttachments((prev) => [...prev, ...uploaded].slice(-8));
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setUploadError(message);
      } finally {
        setUploading(false);
      }
    },
    [projectId, requireLogin],
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
    const outgoingMessage = buildMessageWithAttachments(text, attachments);
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
  const title = currentSession ? formatSessionTitle(currentSession) : 'New chat';

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

  if (!open) {
    return (
      <div className="absolute bottom-5 right-5 z-40">
        <motion.button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="打开 Lumen Agent"
          whileHover={{ scale: 1.04 }}
          whileTap={{ scale: 0.96 }}
          transition={{ type: 'spring', stiffness: 360, damping: 24 }}
          className="flex h-12 w-12 items-center justify-center"
        >
          <LumenOrb active={busy} />
        </motion.button>
      </div>
    );
  }

  return (
    <div className="absolute bottom-[76px] right-3 z-40 h-[min(420px,calc(100vh-152px))] w-[min(500px,calc(100vw-88px))]">
      <motion.aside
        initial={{ opacity: 0, y: 18, scale: 0.985, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, scale: 1, filter: 'blur(0px)' }}
        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
        className="relative flex h-full w-full flex-col overflow-hidden rounded-[24px] border border-white/[0.16] bg-[#171718]/98 text-white shadow-[0_30px_96px_-42px_rgba(0,0,0,0.95)] backdrop-blur-2xl"
      >
        <div className="pointer-events-none absolute inset-x-9 bottom-[82px] h-36 rounded-full bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.055),rgba(121,228,255,0.035)_38%,transparent_72%)] blur-2xl" />

        <header className="relative z-10 flex h-[62px] shrink-0 items-center justify-between px-5">
          <div className="flex min-w-0 items-center gap-2.5">
            <StatusRing busy={busy} compact />
            <button
              type="button"
              onClick={() => setSessionsOpen((value) => !value)}
              aria-label="对话历史"
              title="对话历史"
              className="flex min-w-0 items-center gap-1.5 rounded-lg px-1 py-1 transition-colors hover:bg-white/[0.06]"
            >
              <span className="min-w-0 max-w-[260px] truncate text-[18px] font-semibold tracking-normal text-white">
                {title}
              </span>
              <IconChevronDown
                size={16}
                className={cn(
                  'shrink-0 text-white/42 transition-transform',
                  sessionsOpen ? 'rotate-180' : 'rotate-0',
                )}
                stroke={2.2}
              />
            </button>
          </div>

          <div className="flex items-center text-white/68">
            <button
              type="button"
              onClick={startNewSession}
              disabled={busy}
              aria-label="新建对话"
              title="新建对话"
              className={cn(
                'flex h-8 w-8 items-center justify-center rounded-lg transition-colors',
                busy
                  ? 'cursor-not-allowed text-white/24'
                  : 'text-white/68 hover:bg-white/[0.07] hover:text-white',
              )}
            >
              <IconPlus size={20} stroke={2.2} />
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="收起"
              title="收起"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-white/68 transition-colors hover:bg-white/[0.07] hover:text-white"
            >
              <IconMinus size={23} stroke={2.2} />
            </button>
          </div>
        </header>

        <AnimatePresence>
          {sessionsOpen ? (
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
          className="relative z-10 flex-1 overflow-y-auto px-6 pb-5 pt-1 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]"
        >
          {messages.length === 0 ? (
            <WelcomeMessage />
          ) : (
            <ul className="flex min-h-full flex-col gap-6">
              <AnimatePresence initial={false}>
                {messages.map((message) => (
                  <MessageItem key={message.id} message={message} />
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

      <motion.button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="收起 Lumen Agent"
        title="收起"
        whileHover={{ scale: 1.04 }}
        whileTap={{ scale: 0.96 }}
        transition={{ type: 'spring', stiffness: 360, damping: 24 }}
        className="absolute -bottom-[58px] right-0 z-50 flex h-11 w-11 items-center justify-center"
      >
        <LumenOrb active={busy} />
      </motion.button>
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
          <span className="min-w-0 truncate">New chat</span>
        </button>
      </div>

      <div className="max-h-[236px] overflow-y-auto p-2 [scrollbar-color:rgba(255,255,255,0.18)_transparent] [scrollbar-width:thin]">
        {loading ? (
          <div className="flex h-14 items-center gap-2 px-3 text-[12px] font-medium text-white/40">
            <IconLoader2 size={14} className="animate-spin" stroke={2.4} />
            <span>Loading...</span>
          </div>
        ) : null}

        {!loading && sessions.length === 0 ? (
          <div className="px-3 py-4 text-[12px] font-medium text-white/34">No history yet</div>
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
                  {formatSessionTitle(session)}
                </span>
                <span className="mt-0.5 block truncate text-[11px] leading-4 text-white/34">
                  {formatSessionTime(session.updated_at)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </motion.div>
  );
}

function createDraftSessionId(): string {
  return `studio-${nanoid(12)}`;
}

function formatSessionTitle(session: AgentSessionSummary): string {
  const summary = session.summary?.trim();
  if (summary) return summary;
  const preview = session.last_message_preview?.trim();
  if (preview) return preview.length > 42 ? `${preview.slice(0, 39)}...` : preview;
  return 'Untitled chat';
}

function formatSessionTime(value: string | undefined): string {
  if (!value) return '';
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return '';
  const diffMs = Date.now() - timestamp;
  if (diffMs < 60_000) return 'Just now';
  if (diffMs < 3_600_000) return `${Math.max(1, Math.floor(diffMs / 60_000))}m ago`;
  if (diffMs < 86_400_000) return `${Math.max(1, Math.floor(diffMs / 3_600_000))}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(
    new Date(timestamp),
  );
}

function buildMessageWithAttachments(text: string, attachments: ChatUploadAttachment[]): string {
  if (attachments.length === 0) return text;

  const intro = text.trim() || '请查看我上传的图片。';
  const lines = attachments.map((item, index) => {
    const label = item.name.trim() || `image-${index + 1}`;
    return `${index + 1}. ${label}: ${item.url}`;
  });
  return `${intro}\n\n上传图片：\n${lines.join('\n')}`;
}

async function uploadAgentChatImage(
  file: File,
  workflowId: string | undefined,
): Promise<ChatUploadAttachment> {
  const form = new FormData();
  form.set('file', file);
  if (workflowId) form.set('workflowId', workflowId);

  const response = await fetch('/api/agent-chat/uploads', {
    method: 'POST',
    body: form,
  });
  const rawText = await response.text().catch(() => '');
  const payload = parseUploadResponse(rawText);
  if (!response.ok) {
    throw new Error(readUploadError(payload) ?? (rawText || `HTTP ${response.status}`));
  }

  const attachment = payload?.data?.attachment;
  if (!attachment?.url) {
    throw new Error('上传响应缺少图片地址');
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
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.26, ease: [0.32, 0.72, 0, 1] }}
      className="mt-auto pb-3"
    >
      <div className="max-w-[90%] text-[17px] font-semibold leading-[1.5] text-white/92">
        Hi — what can I help you create on the canvas today?
      </div>
    </motion.div>
  );
}

function MessageItem({ message }: { message: ChatMessage }) {
  return message.role === 'user' ? (
    <UserMessage message={message} />
  ) : (
    <AssistantMessage message={message} />
  );
}

function UserMessage({ message }: { message: ChatMessage }) {
  const richContent = parseRichMessageContent(message.content);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      className="flex justify-end"
    >
      <div className="max-w-[72%] rounded-[16px] bg-[#323335] px-3.5 py-2.5 text-[14px] font-medium leading-6 text-white shadow-[0_12px_32px_-24px_rgba(0,0,0,0.85)]">
        <RichMessageText parts={richContent.parts} />
        <MediaPreviewList media={richContent.media} />
      </div>
    </motion.li>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  const isStreaming = message.status === 'streaming';
  const isFailed = message.status === 'failed';
  const liveLabel = getLiveLabel(message);
  const richContent = parseRichMessageContent(message.content);

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      className="flex items-start"
    >
      <div className="min-w-0 flex-1">
        {message.content ? (
          <div className="max-w-[92%] text-[17px] font-semibold leading-[1.55] text-white/92">
            <RichMessageText parts={richContent.parts} />
            {isStreaming ? <StreamingCaret /> : null}
            <MediaPreviewList media={richContent.media} />
          </div>
        ) : null}

        {isStreaming ? <ThinkingLine label={liveLabel} /> : null}
        <Timeline items={message.events} />
        {message.content && !isStreaming && !isFailed ? <MessageActions /> : null}

        {isFailed ? (
          <div className="mt-3 text-[13px] leading-6 text-[#ff9aa6]">
            {message.error ?? '生成失败'}
          </div>
        ) : null}

        {message.thinking?.trim() && !isStreaming ? (
          <details className="mt-3 max-w-[92%] text-[12px] text-white/38">
            <summary className="cursor-pointer list-none marker:hidden">思考过程</summary>
            <div className="mt-1 whitespace-pre-wrap break-words leading-5">
              {message.thinking.trim()}
            </div>
          </details>
        ) : null}
      </div>
    </motion.li>
  );
}

interface RichTextPart {
  type: 'text' | 'link';
  text: string;
  href?: string;
}

interface MediaAttachment {
  type: 'image' | 'video' | 'audio';
  url: string;
  label: string;
}

function RichMessageText({ parts }: { parts: RichTextPart[] }) {
  return (
    <span className="whitespace-pre-wrap break-words">
      {parts.map((part, index) => {
        if (part.type === 'link' && part.href) {
          return (
            <a
              key={`${part.href}-${index}`}
              href={part.href}
              target="_blank"
              rel="noreferrer"
              className="break-all text-[#8ee7ff] underline decoration-[#8ee7ff]/35 underline-offset-4 transition-colors hover:text-white"
            >
              {part.text}
            </a>
          );
        }
        return <span key={`${part.text}-${index}`}>{part.text}</span>;
      })}
    </span>
  );
}

function MediaPreviewList({ media }: { media: MediaAttachment[] }) {
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
              Your browser does not support the video tag.
            </video>
          ) : null}

          {item.type === 'audio' ? (
            <div className="px-3 py-3">
              {/* biome-ignore lint/a11y/useMediaCaption: Agent-generated audio assets do not include caption tracks yet. */}
              <audio src={item.url} controls preload="metadata" className="w-full" />
            </div>
          ) : null}

          <a
            href={item.url}
            target="_blank"
            rel="noreferrer"
            className="block truncate border-t border-white/[0.08] px-3 py-2 text-[12px] font-medium leading-5 text-white/54 transition-colors hover:text-white/82"
          >
            {item.label}
          </a>
        </div>
      ))}
    </div>
  );
}

function Timeline({ items }: { items?: ChatTimelineItem[] }) {
  const visible = (items ?? []).filter((item) => item.kind !== 'connection').slice(-12);

  if (visible.length === 0) return null;

  return (
    <div className="mt-4 max-w-[94%] space-y-2 border-l border-white/[0.1] pl-3">
      {visible.map((item) => (
        <div
          key={item.id}
          className="group flex min-w-0 items-start gap-2.5 text-[12px] leading-5 text-white/42"
        >
          <TimelineIcon item={item} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <span className="min-w-0 truncate font-medium text-white/68">{item.title}</span>
              <span
                className={cn(
                  'shrink-0 rounded-full border px-1.5 py-0 text-[10px] leading-[16px]',
                  timelineBadgeClass(item.status),
                )}
              >
                {timelineStatusLabel(item)}
              </span>
            </div>
            {item.detail ? (
              <div className="mt-0.5 min-w-0 truncate text-white/32">{item.detail}</div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineIcon({ item }: { item: ChatTimelineItem }) {
  const className = cn(
    'mt-[3px] flex h-4 w-4 shrink-0 items-center justify-center',
    item.status === 'running'
      ? 'text-[#79e4ff]'
      : item.status === 'success'
        ? 'text-[#7ee787]'
        : item.status === 'error'
          ? 'text-[#ff7b8a]'
          : 'text-white/34',
  );

  if (item.status === 'running') {
    return <IconLoader2 size={15} className={cn(className, 'animate-spin')} stroke={2.4} />;
  }
  if (item.status === 'success') return <IconCheck size={15} className={className} stroke={2.6} />;
  if (item.status === 'error') return <IconX size={15} className={className} stroke={2.6} />;

  switch (item.kind) {
    case 'thinking':
      return <IconBrain size={15} className={className} stroke={2.2} />;
    case 'tool':
      return <IconTool size={15} className={className} stroke={2.2} />;
    case 'tool_event':
      return <IconActivity size={15} className={className} stroke={2.2} />;
    case 'step':
      return <IconGitBranch size={15} className={className} stroke={2.2} />;
    case 'error':
      return <IconAlertCircle size={15} className={className} stroke={2.2} />;
    default:
      return <IconCircleDot size={15} className={className} stroke={2.2} />;
  }
}

function MessageActions() {
  return (
    <div className="mt-5 flex items-center gap-4 text-white/46">
      <button type="button" aria-label="复制" className="transition-colors hover:text-white/78">
        <IconCopy size={18} stroke={2.1} />
      </button>
      <button type="button" aria-label="赞" className="transition-colors hover:text-white/78">
        <IconThumbUp size={18} stroke={2.1} />
      </button>
      <button type="button" aria-label="踩" className="transition-colors hover:text-white/78">
        <IconThumbDown size={18} stroke={2.1} />
      </button>
    </div>
  );
}

function ThinkingLine({ label }: { label: string }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 5 }}
      animate={{ opacity: 1, y: 0 }}
      className="mt-5 flex items-center gap-2 text-[13px] text-white/42"
    >
      <LumenMark size={18} className="opacity-65" />
      <IconLoader2 size={13} className="animate-spin text-[#79e4ff]/70" stroke={2.4} />
      <span>{label}</span>
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

function Composer({
  attachments,
  busy,
  draft,
  fileInputRef,
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
  const canSend = Boolean(draft.trim()) || attachments.length > 0;

  return (
    <form onSubmit={onSubmit} className="relative z-10 shrink-0 px-4 pb-4 pt-2">
      <div className="rounded-[22px] border border-white/[0.16] bg-[#222325]/95 px-4 py-3 shadow-[0_18px_70px_-48px_rgba(0,0,0,0.85)] transition-shadow focus-within:border-white/[0.28]">
        {attachments.length > 0 ? (
          <AttachmentStrip attachments={attachments} onRemoveAttachment={onRemoveAttachment} />
        ) : null}

        {uploadError ? (
          <div className="mb-2 rounded-lg border border-[#ff7b8a]/18 bg-[#ff7b8a]/8 px-2.5 py-1.5 text-[12px] leading-5 text-[#ffb6bf]">
            {uploadError}
          </div>
        ) : null}

        <div className="flex items-end gap-3">
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Use '@' to mention nodes and '/' to use skills."
            rows={1}
            className="max-h-[96px] min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[15px] leading-[24px] text-white outline-none placeholder:text-white/30"
          />
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={onFileChange}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy || uploading}
            aria-label={uploading ? '上传中' : '上传图片'}
            title={uploading ? '上传中' : '上传图片'}
            className={cn(
              'mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
              busy || uploading
                ? 'cursor-not-allowed text-white/28'
                : 'text-white/70 hover:bg-white/[0.07] hover:text-white',
            )}
          >
            {uploading ? (
              <IconLoader2 size={18} className="animate-spin" stroke={2.2} />
            ) : (
              <IconPlus size={22} stroke={2.1} />
            )}
          </button>
          <SendOrStopButton busy={busy} canSend={canSend} disabled={uploading} onStop={onStop} />
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
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      {attachments.map((item) => (
        <div
          key={item.id}
          className="group relative flex h-14 min-w-0 max-w-[210px] items-center gap-2 rounded-[12px] border border-white/[0.12] bg-white/[0.045] p-1.5 pr-7"
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
            aria-label="移除图片"
            title="移除图片"
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
  if (busy) {
    return (
      <button
        type="button"
        onClick={onStop}
        aria-label="停止生成"
        title="停止生成"
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white text-[#111315] shadow-[0_12px_30px_-18px_rgba(255,255,255,0.82)] transition-transform active:scale-[0.96]"
      >
        <IconPlayerStopFilled size={14} />
      </button>
    );
  }

  return (
    <button
      type="submit"
      disabled={!canSend || disabled}
      aria-label="发送"
      title="发送"
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all',
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
  parts: RichTextPart[];
  media: MediaAttachment[];
} {
  const parts: RichTextPart[] = [];
  const media = new Map<string, MediaAttachment>();
  const markdownLinkPattern = /\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g;
  let cursor = 0;

  for (const match of content.matchAll(markdownLinkPattern)) {
    const matchStart = match.index ?? 0;
    appendTextWithBareLinks(content.slice(cursor, matchStart), parts, media);

    const label = match[1]?.trim() || 'media';
    const url = normalizeMessageUrl(match[2] ?? '');
    if (url) {
      parts.push({ type: 'link', text: label, href: url });
      addMediaAttachment(media, url, label);
    }
    cursor = matchStart + match[0].length;
  }

  appendTextWithBareLinks(content.slice(cursor), parts, media);

  return { parts, media: [...media.values()] };
}

function appendTextWithBareLinks(
  text: string,
  parts: RichTextPart[],
  media: Map<string, MediaAttachment>,
) {
  if (!text) return;
  const bareUrlPattern = /https?:\/\/[^\s<>"'`]+/g;
  let cursor = 0;

  for (const match of text.matchAll(bareUrlPattern)) {
    const matchStart = match.index ?? 0;
    if (matchStart > cursor) {
      parts.push({ type: 'text', text: text.slice(cursor, matchStart) });
    }

    const url = normalizeMessageUrl(match[0]);
    if (url) {
      const label = shortenUrl(url);
      parts.push({ type: 'link', text: label, href: url });
      addMediaAttachment(media, url, label);
    } else {
      parts.push({ type: 'text', text: match[0] });
    }
    cursor = matchStart + match[0].length;
  }

  if (cursor < text.length) {
    parts.push({ type: 'text', text: text.slice(cursor) });
  }
}

function addMediaAttachment(media: Map<string, MediaAttachment>, url: string, label: string) {
  if (media.has(url)) return;
  const type = detectMediaType(url);
  if (!type) return;
  media.set(url, { type, url, label });
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

function normalizeMessageUrl(raw: string): string | null {
  const trimmed = raw.trim().replace(/[),.;!?]+$/g, '');
  if (!trimmed.startsWith('http://') && !trimmed.startsWith('https://')) return null;
  try {
    return new URL(trimmed).toString();
  } catch {
    return null;
  }
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

function getLiveLabel(message: ChatMessage): string {
  const current = message.events?.findLast?.((event) => event.status === 'running');
  if (!current) return 'Thinking...';
  if (current.kind === 'tool') return current.title;
  if (current.kind === 'step') return 'Thinking...';
  return current.title;
}

function timelineStatusLabel(item: ChatTimelineItem) {
  if (item.kind === 'tool') {
    if (item.status === 'running') return '调用中';
    if (item.status === 'success') return '执行成功';
    if (item.status === 'error') return '执行失败';
  }
  if (item.kind === 'thinking') {
    return item.status === 'running' ? '思考中' : '已记录';
  }
  switch (item.status) {
    case 'queued':
      return '排队中';
    case 'running':
      return '进行中';
    case 'success':
      return '成功';
    case 'error':
      return '失败';
    default:
      return '事件';
  }
}

function timelineBadgeClass(status: ChatTimelineItem['status']) {
  switch (status) {
    case 'queued':
      return 'border-white/12 bg-white/[0.04] text-white/42';
    case 'running':
      return 'border-[#79e4ff]/22 bg-[#79e4ff]/10 text-[#9defff]';
    case 'success':
      return 'border-[#7ee787]/22 bg-[#7ee787]/10 text-[#a7f3b4]';
    case 'error':
      return 'border-[#ff7b8a]/25 bg-[#ff7b8a]/10 text-[#ffadb7]';
    default:
      return 'border-white/10 bg-white/[0.03] text-white/34';
  }
}

function isBusy(status: AgentChatStatus): boolean {
  return status === 'creating' || status === 'streaming' || status === 'reconnecting';
}
