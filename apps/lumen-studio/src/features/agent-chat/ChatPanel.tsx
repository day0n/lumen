'use client';

/**
 * Canvas 右侧 Agent Chat。
 *
 * 这里保持界面很轻：提交后只显示用户消息、轻量 Thinking 状态和最终回复；
 * 详细 SSE event 仍在 hook 内维护，必要时再扩展为调试面板。
 */

import { LumenMark } from '@/components/ui/LumenMark';
import { cn } from '@/lib/cn';
import {
  IconArrowUp,
  IconChevronDown,
  IconCopy,
  IconLoader2,
  IconMinus,
  IconPlayerStopFilled,
  IconPlus,
  IconThumbDown,
  IconThumbUp,
} from '@tabler/icons-react';
import { AnimatePresence, motion } from 'motion/react';
import { usePathname, useRouter } from 'next/navigation';
import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { useAuth } from '@clerk/nextjs';

import {
  type AgentChatStatus,
  type ChatMessage,
  useAgentChat,
} from '@/features/agent-chat/use-agent-chat';

interface ChatPanelProps {
  sessionId?: string;
  initialPrompt?: string | null;
  defaultOpen?: boolean;
}

export function ChatPanel({ sessionId, initialPrompt, defaultOpen = false }: ChatPanelProps) {
  const { messages, status, errorText, send, stop } = useAgentChat({ sessionId });
  const { isLoaded: authReady } = useAuth();
  const [open, setOpen] = useState(defaultOpen);
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const autoSentRef = useRef(false);
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (autoSentRef.current || !authReady) return;
    const trimmed = initialPrompt?.trim();
    if (!trimmed) return;
    autoSentRef.current = true;
    setOpen(true);
    void send(trimmed);
    router.replace(pathname, { scroll: false });
  }, [initialPrompt, send, router, pathname, authReady]);

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

  const busy = isBusy(status);

  const submit = () => {
    const text = draft.trim();
    if (!text || busy) return;
    setDraft('');
    void send(text);
  };

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
            <div className="flex min-w-0 items-center gap-1.5">
              <div className="min-w-0 truncate text-[18px] font-semibold tracking-normal text-white">
                Hello
              </div>
              <IconChevronDown size={16} className="text-white/42" stroke={2.2} />
            </div>
          </div>

          <div className="flex items-center text-white/68">
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
          busy={busy}
          draft={draft}
          textareaRef={textareaRef}
          onDraftChange={setDraft}
          onKeyDown={handleKeyDown}
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
  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 10, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.22, ease: [0.32, 0.72, 0, 1] }}
      className="flex justify-end"
    >
      <div className="max-w-[72%] rounded-[16px] bg-[#323335] px-3.5 py-2.5 text-[14px] font-medium leading-6 text-white shadow-[0_12px_32px_-24px_rgba(0,0,0,0.85)]">
        <span className="whitespace-pre-wrap break-words">{message.content}</span>
      </div>
    </motion.li>
  );
}

function AssistantMessage({ message }: { message: ChatMessage }) {
  const isStreaming = message.status === 'streaming';
  const isFailed = message.status === 'failed';
  const liveLabel = getLiveLabel(message);

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
          <div className="max-w-[92%] whitespace-pre-wrap break-words text-[17px] font-semibold leading-[1.55] text-white/92">
            <span className="whitespace-pre-wrap break-words">{message.content}</span>
            {isStreaming ? <StreamingCaret /> : null}
          </div>
        ) : null}

        {isStreaming ? <ThinkingLine label={liveLabel} /> : null}
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
  busy,
  draft,
  textareaRef,
  onDraftChange,
  onKeyDown,
  onSubmit,
  onStop,
}: {
  busy: boolean;
  draft: string;
  textareaRef: RefObject<HTMLTextAreaElement | null>;
  onDraftChange: (value: string) => void;
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onStop: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="relative z-10 shrink-0 px-4 pb-4 pt-2">
      <div className="flex items-end gap-3 rounded-[22px] border border-white/[0.16] bg-[#222325]/95 px-4 py-3 shadow-[0_18px_70px_-48px_rgba(0,0,0,0.85)] transition-shadow focus-within:border-white/[0.28]">
        <textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => onDraftChange(event.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Use '@' to mention nodes and '/' to use skills."
          rows={1}
          className="max-h-[96px] min-h-[28px] flex-1 resize-none bg-transparent py-1 text-[15px] leading-[24px] text-white outline-none placeholder:text-white/30"
        />
        <button
          type="button"
          aria-label="添加"
          className="mb-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white"
        >
          <IconPlus size={22} stroke={2.1} />
        </button>
        <SendOrStopButton busy={busy} canSend={Boolean(draft.trim())} onStop={onStop} />
      </div>
    </form>
  );
}

function SendOrStopButton({
  busy,
  canSend,
  onStop,
}: {
  busy: boolean;
  canSend: boolean;
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
      disabled={!canSend}
      aria-label="发送"
      title="发送"
      className={cn(
        'flex h-10 w-10 shrink-0 items-center justify-center rounded-full transition-all',
        canSend
          ? 'bg-white text-[#111315] shadow-[0_12px_30px_-18px_rgba(255,255,255,0.82)] hover:brightness-95 active:scale-[0.96]'
          : 'bg-white/[0.07] text-white/28 ring-1 ring-white/[0.06]',
      )}
    >
      <IconArrowUp size={17} stroke={2.8} />
    </button>
  );
}

function getLiveLabel(message: ChatMessage): string {
  const current = message.events?.findLast?.((event) => event.status === 'running');
  if (!current) return 'Thinking...';
  if (current.kind === 'tool') return current.title;
  if (current.kind === 'step') return 'Thinking...';
  return current.title;
}

function isBusy(status: AgentChatStatus): boolean {
  return status === 'creating' || status === 'streaming' || status === 'reconnecting';
}
