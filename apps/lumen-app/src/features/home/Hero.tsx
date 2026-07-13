'use client';

import {
  IconArrowUp,
  IconArrowUpRight,
  IconPhoto,
  IconPhotoPlus,
  IconPlus,
  IconSparkles,
  IconX,
} from '@tabler/icons-react';
import { motion } from 'motion/react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type { CSSProperties, PointerEvent } from 'react';
import Link from '../../compat/next-link';
import { useRouter } from '../../compat/next-navigation';
import { VoiceInputControl } from '../../components/voice/VoiceInputControl';
import { appendSpeechTranscript, useSpeechToText } from '../../hooks/use-speech-to-text';
import { readMessageObjectArray } from '../../i18n/messages';
import { useI18n } from '../../i18n/provider';
import { useLoginRedirect } from '../../lib/auth-redirect';

interface RecentProject {
  id: string;
  title: string;
  updatedAt: string;
  thumbnail?: string;
}

type ProjectsApiResponse =
  | {
      ok: true;
      data: { projects: RecentProject[] };
    }
  | {
      ok: false;
      error: { message: string };
    };

interface AttachedImage {
  id: string;
  name: string;
  size: number;
  previewUrl: string;
}

const HERO_ATTACHMENTS_STORAGE_KEY = 'lumen:hero:attachments';
const MAX_IMAGE_SIZE = 8 * 1024 * 1024;
const MAX_IMAGES = 6;

const COVER_GRADIENTS = [
  'linear-gradient(135deg,#496cae,#6987c4)',
  'linear-gradient(135deg,#c9d0d8,#5d6877 52%,#3b4654)',
  'linear-gradient(135deg,#78a1d2,#627083)',
  'linear-gradient(135deg,#a06b9c,#5d4f74)',
  'linear-gradient(135deg,#5e8970,#384b53)',
];

export function Hero() {
  const router = useRouter();
  const { locale, t, localePath } = useI18n();
  const { isLoaded: authLoaded, isSignedIn, requireLogin } = useLoginRedirect();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const chatPanelRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState('');
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [recentsLoaded, setRecentsLoaded] = useState(false);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const {
    listening,
    supported: speechSupported,
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
      setValue((current) => appendSpeechTranscript(current, chunk));
    },
  });

  useEffect(() => {
    if (!authLoaded) return;
    if (!isSignedIn) {
      setRecents([]);
      setRecentsLoaded(true);
      return;
    }

    const controller = new AbortController();
    setRecentsLoaded(false);

    async function load() {
      try {
        const response = await fetch('/api/projects?limit=3', {
          signal: controller.signal,
          credentials: 'include',
          headers: { 'x-lumen-locale': locale },
        });
        if (response.status === 401) {
          setRecents([]);
          return;
        }
        const payload = (await response.json()) as ProjectsApiResponse;
        if (!response.ok || !payload.ok) {
          setRecents([]);
          return;
        }
        setRecents(payload.data.projects.slice(0, 3));
      } catch {
        if (!controller.signal.aborted) setRecents([]);
      } finally {
        if (!controller.signal.aborted) setRecentsLoaded(true);
      }
    }

    void load();
    return () => controller.abort();
  }, [authLoaded, isSignedIn, locale]);

  const attachedImagesRef = useRef<AttachedImage[]>([]);
  attachedImagesRef.current = attachedImages;

  // Revoke any remaining blob URLs when the component unmounts.
  useEffect(() => {
    return () => {
      for (const image of attachedImagesRef.current) {
        URL.revokeObjectURL(image.previewUrl);
      }
    };
  }, []);

  const handleFiles = async (fileList: FileList | null) => {
    if (!fileList) return;
    const files = Array.from(fileList);
    if (!files.length) return;

    const slotsLeft = MAX_IMAGES - attachedImages.length;
    if (slotsLeft <= 0) {
      setAttachError(t('home.maxImages', { count: MAX_IMAGES }));
      return;
    }

    const accepted: AttachedImage[] = [];
    let rejectedReason: string | null = null;

    for (const file of files.slice(0, slotsLeft)) {
      if (!file.type.startsWith('image/')) {
        rejectedReason = t('home.notImage', { name: file.name });
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        rejectedReason = t('home.imageTooLarge', { name: file.name });
        continue;
      }
      accepted.push({
        id: `${file.name}-${file.size}-${file.lastModified}-${Math.random().toString(36).slice(2, 8)}`,
        name: file.name,
        size: file.size,
        previewUrl: URL.createObjectURL(file),
      });
    }

    if (accepted.length) {
      setAttachedImages((current) => [...current, ...accepted]);
    }
    setAttachError(rejectedReason);
  };

  const removeImage = (id: string) => {
    setAttachedImages((current) => {
      const target = current.find((image) => image.id === id);
      if (target) URL.revokeObjectURL(target.previewUrl);
      return current.filter((image) => image.id !== id);
    });
    setAttachError(null);
  };

  const goCreate = async (promptOverride?: string) => {
    const prompt = (promptOverride ?? value).trim();
    const params = new URLSearchParams({ agent: 'chat' });
    if (prompt) params.set('prompt', prompt);
    const target = `/canvas/new?${params.toString()}`;

    if (attachedImages.length > 0 && typeof window !== 'undefined') {
      try {
        const serialized = await Promise.all(
          attachedImages.map(async (image) => ({
            name: image.name,
            size: image.size,
            dataUrl: await blobUrlToDataUrl(image.previewUrl),
          })),
        );
        sessionStorage.setItem(
          HERO_ATTACHMENTS_STORAGE_KEY,
          JSON.stringify({ savedAt: Date.now(), images: serialized }),
        );
      } catch {
        // sessionStorage might be full; carry on without attachments.
      }
    } else if (typeof window !== 'undefined') {
      sessionStorage.removeItem(HERO_ATTACHMENTS_STORAGE_KEY);
    }

    if (!requireLogin(target)) return;
    router.push(localePath(target));
  };

  const quickActions = readMessageObjectArray<{ label: string; prompt: string }>(
    locale,
    'home.quickActions',
  );

  const handleChatPanelPointerMove = useCallback((event: PointerEvent<HTMLDivElement>) => {
    const panel = chatPanelRef.current;
    const rect = panel?.getBoundingClientRect();
    if (!rect) return;

    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const dx = x - centerX;
    const dy = y - centerY;
    const edgeScaleX = dx === 0 ? Number.POSITIVE_INFINITY : centerX / Math.abs(dx);
    const edgeScaleY = dy === 0 ? Number.POSITIVE_INFINITY : centerY / Math.abs(dy);
    const edgeProximity = Math.min(Math.max(1 / Math.min(edgeScaleX, edgeScaleY), 0), 1);
    const angle = Math.atan2(dy, dx) * (180 / Math.PI) + 90;
    panel?.style.setProperty('--edge-proximity', `${(edgeProximity * 100).toFixed(3)}`);
    panel?.style.setProperty(
      '--cursor-angle',
      `${(angle < 0 ? angle + 360 : angle).toFixed(3)}deg`,
    );
  }, []);

  const handleChatPanelPointerLeave = useCallback(() => {
    chatPanelRef.current?.style.setProperty('--edge-proximity', '0');
  }, []);

  return (
    <section className="relative mx-auto mt-8 max-w-[760px] px-6">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}
        className="relative"
      >
        <div className="pointer-events-none absolute -right-14 -top-14 hidden rotate-[12deg] rounded-2xl border border-white/14 bg-[#181a1d] px-4 py-2 text-[12px] font-semibold text-white/64 shadow-[0_18px_60px_-42px_rgba(255,255,255,0.42)] md:block">
          {t('home.heroBadge')}
        </div>

        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] text-white ring-1 ring-white/[0.08]">
            <IconSparkles size={19} stroke={2.2} />
          </span>
          <h1 className="font-display text-[28px] font-extrabold tracking-tight text-white">
            {t('home.heroTitle')}
          </h1>
        </div>

        <div
          ref={chatPanelRef}
          onPointerMove={handleChatPanelPointerMove}
          onPointerLeave={handleChatPanelPointerLeave}
          className="material-category-glow home-chat-glow mt-5 rounded-[18px]"
          style={
            {
              '--lumen-border-glow-hsl': '40 80 80',
              '--lumen-border-glow-one': '#c084fc',
              '--lumen-border-glow-two': '#f472b6',
              '--lumen-border-glow-three': '#38bdf8',
              '--lumen-border-glow-mask': '#1d1f21',
              '--lumen-border-fill-opacity': '0',
            } as CSSProperties
          }
        >
          <span aria-hidden className="material-category-edge-light" />
          <div className="relative z-[2] overflow-hidden rounded-[inherit] bg-[#1d1f21] shadow-[0_20px_70px_-44px_rgba(0,0,0,0.9)] ring-1 ring-white/[0.09]">
            <textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              placeholder={t('home.heroPlaceholder')}
              className="h-[92px] w-full resize-none bg-transparent px-5 py-4 text-[14px] leading-6 text-white outline-none placeholder:text-white/34"
            />

            {attachedImages.length > 0 ? (
              <div className="flex flex-wrap gap-2 border-t border-white/[0.06] px-4 py-3">
                {attachedImages.map((image) => (
                  <div
                    key={image.id}
                    className="group/chip relative h-14 w-14 overflow-hidden rounded-xl ring-1 ring-white/[0.08]"
                    title={image.name}
                  >
                    <img
                      src={image.previewUrl}
                      alt={image.name}
                      className="h-full w-full object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeImage(image.id)}
                      aria-label={`${t('common.remove')} ${image.name}`}
                      className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/72 text-white opacity-0 ring-1 ring-white/[0.18] transition-opacity group-hover/chip:opacity-100"
                    >
                      <IconX size={11} stroke={2.6} />
                    </button>
                  </div>
                ))}
              </div>
            ) : null}

            {attachError ? (
              <div className="border-t border-white/[0.06] px-4 py-2 text-[12px] text-[#f5c76a]">
                {attachError}
              </div>
            ) : null}

            <div className="flex items-center gap-2 border-t border-white/[0.06] px-3 py-3">
              <input
                ref={fileInputRef}
                id={fileInputId}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(event) => {
                  void handleFiles(event.target.files);
                  event.currentTarget.value = '';
                }}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                aria-label={t('home.uploadImage')}
                title={t('home.uploadImageTitle', { count: MAX_IMAGES })}
                disabled={attachedImages.length >= MAX_IMAGES}
                className="flex min-h-11 min-w-11 items-center justify-center rounded-xl bg-white/[0.055] text-white/52 transition-colors hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
              >
                <IconPhotoPlus size={17} stroke={2.1} />
              </button>
              <VoiceInputControl
                listening={listening}
                supported={speechSupported}
                error={speechError}
                variant="hero"
                labels={{
                  voiceInput: t('home.voiceInput'),
                  voiceStop: t('home.voiceStop'),
                  voiceUnsupported: t('home.voiceUnsupported'),
                  voiceCancel: t('home.voiceCancel'),
                }}
                onToggle={toggle}
                onCancel={cancel}
              />

              <div className="ml-auto flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    void goCreate();
                  }}
                  aria-label={t('home.sendGenerate')}
                  className="flex min-h-11 min-w-11 items-center justify-center rounded-full bg-white text-[#111315] shadow-[0_10px_28px_-16px_rgba(255,255,255,0.7)] transition-transform active:scale-[0.96]"
                >
                  <IconArrowUp size={18} stroke={2.6} />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-white/35">{t('home.try')}</span>
          {quickActions.map((action) => (
            <button
              key={action.label}
              type="button"
              onClick={() => setValue(action.prompt)}
              title={action.prompt}
              className="min-h-11 rounded-full bg-white/[0.045] px-3 py-1.5 text-[12px] text-white/55 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              {action.label}
            </button>
          ))}
        </div>

        {recentsLoaded && recents.length === 0 ? (
          <div className="mt-5 overflow-hidden rounded-2xl bg-[linear-gradient(135deg,rgba(192,132,252,0.14),rgba(56,189,248,0.1)_58%,rgba(29,31,33,0.92))] p-5 ring-1 ring-white/[0.1]">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white/[0.1] text-white ring-1 ring-white/[0.12]">
                <IconSparkles size={20} stroke={2.2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-bold text-white">{t('home.firstTaskTitle')}</div>
                <div className="mt-1 text-[12.5px] leading-5 text-white/55">
                  {t('home.firstTaskSubtitle')}
                </div>
              </div>
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                onClick={() => {
                  void goCreate(quickActions[0]?.prompt);
                }}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white px-4 text-[13px] font-bold text-[#111315] transition-transform active:scale-[0.97]"
              >
                {t('home.firstTaskCta')}
                <IconArrowUpRight size={15} stroke={2.6} />
              </button>
              {quickActions[0] ? (
                <span className="text-[12px] text-white/42">{quickActions[0].label}</span>
              ) : null}
            </div>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
            <button
              type="button"
              onClick={() => {
                void goCreate();
              }}
              className="group flex h-[116px] flex-col items-center justify-center gap-2 rounded-xl bg-[#222426] text-white/68 ring-1 ring-white/[0.08] transition-colors hover:bg-[#282b2e] hover:text-white"
            >
              <IconPlus size={20} stroke={2.4} />
              <span className="text-[12px] font-semibold">{t('home.newProject')}</span>
            </button>

            {recents.map((project, index) => (
              <Link
                key={project.id}
                href={localePath(`/canvas/${project.id}`)}
                className="group overflow-hidden rounded-xl bg-[#202121] text-left ring-1 ring-white/[0.08] transition-colors hover:bg-[#262829]"
              >
                <div
                  className="relative h-[68px] overflow-hidden"
                  style={
                    project.thumbnail
                      ? undefined
                      : { background: COVER_GRADIENTS[index % COVER_GRADIENTS.length] }
                  }
                >
                  {project.thumbnail ? (
                    <>
                      <img
                        src={project.thumbnail}
                        alt=""
                        decoding="async"
                        loading="lazy"
                        className="absolute inset-0 h-full w-full object-cover"
                      />
                      <div className="absolute inset-0 opacity-40 mix-blend-soft-light [background-image:linear-gradient(120deg,transparent_20%,rgba(255,255,255,0.35)_48%,transparent_62%)]" />
                    </>
                  ) : project.id.charCodeAt(0) % 3 === 0 ? (
                    <IconPhoto
                      size={24}
                      className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/18"
                      stroke={1.7}
                    />
                  ) : null}
                </div>
                <div className="flex items-start gap-2 px-2.5 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11.5px] font-bold text-white/76">
                      {project.title}
                    </div>
                    <div className="mt-1 truncate text-[10.5px] text-white/35">
                      {t('home.edited', {
                        time: formatRelativeTime(project.updatedAt, locale, t),
                      })}
                    </div>
                  </div>
                  <IconArrowUpRight
                    size={13}
                    className="mt-0.5 text-white/35 transition-colors group-hover:text-white/75"
                    stroke={2.1}
                  />
                </div>
              </Link>
            ))}
          </div>
        )}
      </motion.div>
    </section>
  );
}

async function blobUrlToDataUrl(blobUrl: string): Promise<string> {
  const response = await fetch(blobUrl);
  const blob = await response.blob();
  return await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === 'string' ? reader.result : '');
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

function formatRelativeTime(
  iso: string,
  locale: string,
  t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string,
) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return t('common.recently');

  const diffSeconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSeconds < 60) return t('common.justNow');

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60)
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-diffMinutes, 'minute');

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24)
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-diffHours, 'hour');

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30)
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-diffDays, 'day');

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12)
    return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(-diffMonths, 'month');

  return new Intl.RelativeTimeFormat(locale, { numeric: 'auto' }).format(
    -Math.floor(diffMonths / 12),
    'year',
  );
}
