'use client';

import {
  IconArrowUp,
  IconArrowUpRight,
  IconMicrophone,
  IconMicrophoneOff,
  IconPhotoPlus,
  IconPlus,
  IconSparkles,
  IconX,
} from '@tabler/icons-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useRef, useState } from 'react';

interface RecentProject {
  id: string;
  title: string;
  updatedAt: string;
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

const QUICK_ACTIONS = ['夏日防晒面膜', '磁吸耳机 Pro', '复古牛仔外套'];

const COVER_GRADIENTS = [
  'linear-gradient(135deg,#496cae,#6987c4)',
  'linear-gradient(135deg,#c9d0d8,#5d6877 52%,#3b4654)',
  'linear-gradient(135deg,#78a1d2,#627083)',
  'linear-gradient(135deg,#a06b9c,#5d4f74)',
  'linear-gradient(135deg,#5e8970,#384b53)',
];

export function Hero() {
  const router = useRouter();
  const fileInputId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [recents, setRecents] = useState<RecentProject[]>([]);
  const [attachedImages, setAttachedImages] = useState<AttachedImage[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const {
    listening,
    supported: speechSupported,
    error: speechError,
    toggle,
  } = useSpeechToText({
    onTranscript: (chunk) => {
      setValue((current) => {
        const trimmed = current.trimEnd();
        const separator = trimmed.length > 0 && !/[，。！？,.!?]$/.test(trimmed) ? ' ' : '';
        return `${trimmed}${separator}${chunk}`.trimStart();
      });
    },
  });

  useEffect(() => {
    const controller = new AbortController();

    async function load() {
      try {
        const response = await fetch('/api/projects?limit=3', {
          signal: controller.signal,
          credentials: 'include',
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
      }
    }

    void load();
    return () => controller.abort();
  }, []);

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
      setAttachError(`最多上传 ${MAX_IMAGES} 张图片`);
      return;
    }

    const accepted: AttachedImage[] = [];
    let rejectedReason: string | null = null;

    for (const file of files.slice(0, slotsLeft)) {
      if (!file.type.startsWith('image/')) {
        rejectedReason = `${file.name} 不是图片`;
        continue;
      }
      if (file.size > MAX_IMAGE_SIZE) {
        rejectedReason = `${file.name} 超过 8MB`;
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

  const goCreate = async () => {
    const prompt = value.trim();

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

    router.push(prompt ? `/canvas/new?prompt=${encodeURIComponent(prompt)}` : '/canvas/new');
  };

  const voiceLabel = !speechSupported
    ? '当前浏览器不支持语音输入'
    : speechError
      ? speechError
      : listening
        ? '点击结束录音'
        : '语音输入';

  return (
    <section className="relative mx-auto mt-8 max-w-[760px] px-6">
      <motion.div
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, ease: [0.32, 0.72, 0, 1] }}
        className="relative"
      >
        <div className="pointer-events-none absolute -right-14 -top-14 hidden rotate-[12deg] rounded-2xl border border-white/14 bg-[#181a1d] px-4 py-2 text-[12px] font-semibold text-white/64 shadow-[0_18px_60px_-42px_rgba(255,255,255,0.42)] md:block">
          下一条爆款脚本，交给我执行
        </div>

        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/[0.08] text-white ring-1 ring-white/[0.08]">
            <IconSparkles size={19} stroke={2.2} />
          </span>
          <h1 className="font-display text-[28px] font-extrabold tracking-tight text-white">
            今天要做点什么？
          </h1>
        </div>

        <div className="mt-5 overflow-hidden rounded-[18px] bg-[#1d1f21] shadow-[0_20px_70px_-44px_rgba(0,0,0,0.9)] ring-1 ring-white/[0.09]">
          <textarea
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="开始一段灵感对话，或者贴一个商品链接..."
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
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={image.previewUrl}
                    alt={image.name}
                    className="h-full w-full object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => removeImage(image.id)}
                    aria-label={`移除 ${image.name}`}
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
              aria-label="上传图片"
              title={`上传图片（最多 ${MAX_IMAGES} 张）`}
              disabled={attachedImages.length >= MAX_IMAGES}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.055] text-white/52 transition-colors hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:opacity-45"
            >
              <IconPhotoPlus size={17} stroke={2.1} />
            </button>
            <button
              type="button"
              onClick={() => {
                if (!speechSupported) return;
                toggle();
              }}
              disabled={!speechSupported}
              aria-pressed={listening}
              aria-label={voiceLabel}
              title={voiceLabel}
              className={
                listening
                  ? 'flex h-9 w-9 items-center justify-center rounded-xl bg-[#ff5fbf]/22 text-[#ff5fbf] ring-1 ring-[#ff5fbf]/55 transition-colors'
                  : 'flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.055] text-white/52 transition-colors hover:bg-white/[0.09] hover:text-white disabled:cursor-not-allowed disabled:opacity-45'
              }
            >
              {listening ? (
                <IconMicrophone size={17} stroke={2.1} className="animate-pulse" />
              ) : speechSupported ? (
                <IconMicrophone size={17} stroke={2.1} />
              ) : (
                <IconMicrophoneOff size={17} stroke={2.1} />
              )}
            </button>

            <div className="ml-auto flex items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  void goCreate();
                }}
                aria-label="发送并生成"
                className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#111315] shadow-[0_10px_28px_-16px_rgba(255,255,255,0.7)] transition-transform active:scale-[0.96]"
              >
                <IconArrowUp size={18} stroke={2.6} />
              </button>
            </div>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-[12px] text-white/35">试试</span>
          {QUICK_ACTIONS.map((prompt) => (
            <button
              key={prompt}
              type="button"
              onClick={() => setValue(prompt)}
              className="rounded-full bg-white/[0.045] px-3 py-1.5 text-[12px] text-white/55 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.08] hover:text-white"
            >
              {prompt}
            </button>
          ))}
        </div>

        <div className="mt-5 grid grid-cols-2 gap-2 md:grid-cols-4">
          <button
            type="button"
            onClick={() => {
              void goCreate();
            }}
            className="group flex h-[116px] flex-col items-center justify-center gap-2 rounded-xl bg-[#222426] text-white/68 ring-1 ring-white/[0.08] transition-colors hover:bg-[#282b2e] hover:text-white"
          >
            <IconPlus size={20} stroke={2.4} />
            <span className="text-[12px] font-semibold">新建项目</span>
          </button>

          {recents.map((project, index) => (
            <Link
              key={project.id}
              href={`/canvas/${project.id}`}
              className="group overflow-hidden rounded-xl bg-[#202121] text-left ring-1 ring-white/[0.08] transition-colors hover:bg-[#262829]"
            >
              <div
                className="h-[68px]"
                style={{ background: COVER_GRADIENTS[index % COVER_GRADIENTS.length] }}
              />
              <div className="flex items-start gap-2 px-2.5 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[11.5px] font-bold text-white/76">
                    {project.title}
                  </div>
                  <div className="mt-1 truncate text-[10.5px] text-white/35">
                    编辑于 {formatRelativeTime(project.updatedAt)}
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
      </motion.div>
    </section>
  );
}

interface SpeechRecognitionEventLike extends Event {
  results: ArrayLike<{ 0: { transcript: string }; isFinal: boolean }>;
  resultIndex: number;
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string;
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null;
  onend: (() => void) | null;
}

interface SpeechRecognitionConstructor {
  new (): SpeechRecognitionLike;
}

function useSpeechToText(options: { onTranscript: (chunk: string) => void }) {
  const { onTranscript } = options;
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const callbackRef = useRef(onTranscript);
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [supported, setSupported] = useState(false);

  callbackRef.current = onTranscript;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const Ctor =
      (
        window as unknown as {
          SpeechRecognition?: SpeechRecognitionConstructor;
          webkitSpeechRecognition?: SpeechRecognitionConstructor;
        }
      ).SpeechRecognition ??
      (window as unknown as { webkitSpeechRecognition?: SpeechRecognitionConstructor })
        .webkitSpeechRecognition;

    if (!Ctor) {
      setSupported(false);
      return;
    }
    setSupported(true);

    const recognition = new Ctor();
    recognition.continuous = false;
    recognition.interimResults = false;
    recognition.lang = 'zh-CN';

    recognition.onresult = (event) => {
      const results = Array.from(event.results as ArrayLike<{ 0: { transcript: string } }>);
      const transcript = results
        .map((result) => result[0]?.transcript ?? '')
        .join('')
        .trim();
      if (transcript) callbackRef.current(transcript);
    };
    recognition.onerror = (event) => {
      const code = event.error;
      if (code === 'not-allowed' || code === 'service-not-allowed') {
        setError('请允许浏览器使用麦克风');
      } else if (code === 'no-speech') {
        setError('没听到语音，请再试一次');
      } else if (code === 'aborted') {
        setError(null);
      } else {
        setError('语音识别失败，请稍后再试');
      }
      setListening(false);
    };
    recognition.onend = () => {
      setListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      try {
        recognition.abort();
      } catch {
        // ignore
      }
      recognitionRef.current = null;
    };
  }, []);

  const toggle = () => {
    const recognition = recognitionRef.current;
    if (!recognition) return;
    if (listening) {
      try {
        recognition.stop();
      } catch {
        // already stopped
      }
      return;
    }
    setError(null);
    try {
      recognition.start();
      setListening(true);
    } catch {
      // start() throws if already running
    }
  };

  return { listening, supported, error, toggle };
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

function formatRelativeTime(iso: string) {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '最近';

  const diffSeconds = Math.max(0, Math.floor((Date.now() - then) / 1000));
  if (diffSeconds < 60) return '刚刚';

  const diffMinutes = Math.floor(diffSeconds / 60);
  if (diffMinutes < 60) return `${diffMinutes} 分钟前`;

  const diffHours = Math.floor(diffMinutes / 60);
  if (diffHours < 24) return `${diffHours} 小时前`;

  const diffDays = Math.floor(diffHours / 24);
  if (diffDays < 30) return `${diffDays} 天前`;

  const diffMonths = Math.floor(diffDays / 30);
  if (diffMonths < 12) return `${diffMonths} 个月前`;

  return `${Math.floor(diffMonths / 12)} 年前`;
}
