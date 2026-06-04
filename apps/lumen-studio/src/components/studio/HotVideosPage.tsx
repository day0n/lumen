'use client';

import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { Topbar } from '@/components/home/Topbar';
import { HotVideoRemakePipeline } from '@/components/studio/HotVideoRemakePipeline';
import { RemakeJobsDrawer } from '@/components/studio/RemakeJobsDrawer';
import { useI18n } from '@/i18n/provider';
import type { Locale } from '@/i18n/routing';
import { useLoginRedirect } from '@/lib/auth-redirect';
import { cn } from '@/lib/cn';
import { useUser } from '@clerk/nextjs';
import type { HotVideoRecord } from '@lumen/db';
import {
  IconArrowRight,
  IconCalendar,
  IconCheck,
  IconChevronDown,
  IconChevronRight,
  IconCopyPlus,
  IconExternalLink,
  IconEye,
  IconFlame,
  IconHeart,
  IconHistory,
  IconLink,
  IconLoader2,
  IconLock,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSelector,
  IconSettings,
  IconShoppingBag,
  IconTrendingUp,
  IconUpload,
  IconX,
} from '@tabler/icons-react';
import { motion } from 'motion/react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';

type FilterKey = 'owner' | 'region' | 'category' | 'gmv' | 'videoType' | 'published';

interface HotVideoView {
  id: string;
  ownerUserId?: string;
  title: string;
  product: string;
  category: string;
  region: string;
  videoType: string;
  publishedAt: string;
  publishedDaysAgo: number;
  sales: number;
  revenueUsd: number;
  revenueLabel: string;
  viewsCount: number;
  viewsLabel: string;
  roas: number;
  hook: string;
  angle: string;
  score: number;
  paletteCss: string;
  accent: string;
  tags: string[];
  structure: string[];
  sourceUrl?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
}

interface ReferenceItem {
  id: string;
  label: string;
  value: string;
  source: 'link' | 'video';
}

interface UploadedProductImage {
  id: string;
  name: string;
  file: File;
  previewUrl: string;
  uploadedUrl?: string;
}

type RemakePreparingState = {
  phase: 'upload' | 'remake';
  uploadCurrent: number;
  uploadTotal: number;
};

const ASPECT_RATIO_OPTIONS = ['9:16', '1:1', '16:9'] as const;
type AspectRatioOption = (typeof ASPECT_RATIO_OPTIONS)[number];

const DURATION_OPTIONS = ['9s', '12s', '15s'] as const;
type DurationOption = (typeof DURATION_OPTIONS)[number];

const COPY_LANGUAGE_OPTIONS = ['zh', 'en'] as const;
type CopyLanguageOption = (typeof COPY_LANGUAGE_OPTIONS)[number];

const RESOLUTION_OPTIONS = ['720p', '1080p'] as const;
type ResolutionOption = (typeof RESOLUTION_OPTIONS)[number];

interface ListHotVideosApiResponse {
  ok: boolean;
  data?: { items: HotVideoRecord[]; total: number };
  error?: { message: string };
}

interface CanvasUploadApiResponse {
  ok: boolean;
  data?: { asset: { url: string } };
  error?: { message: string };
}

interface CreateRemakeJobResponse {
  ok: boolean;
  data?: { job: { id: string } };
  error?: { message: string };
}

type Filters = Record<FilterKey, string>;

interface FilterOption {
  value: string;
  labelKey: string;
  apiValue?: string;
}

interface FilterConfig {
  key: FilterKey;
  labelKey: string;
  options: FilterOption[];
}

const FILTERS: FilterConfig[] = [
  {
    key: 'owner',
    labelKey: 'hotVideos.filters.owner',
    options: [
      { value: 'all', labelKey: 'hotVideos.filters.all' },
      { value: 'me', labelKey: 'hotVideos.filters.mine' },
    ],
  },
  {
    key: 'region',
    labelKey: 'hotVideos.filters.region',
    options: [
      { value: 'all', labelKey: 'hotVideos.filters.all' },
      { value: 'us', labelKey: 'hotVideos.filters.us', apiValue: '美国' },
      { value: 'vietnam', labelKey: 'hotVideos.filters.vietnam', apiValue: '越南' },
      { value: 'philippines', labelKey: 'hotVideos.filters.philippines', apiValue: '菲律宾' },
      { value: 'thailand', labelKey: 'hotVideos.filters.thailand', apiValue: '泰国' },
      { value: 'spain', labelKey: 'hotVideos.filters.spain', apiValue: '西班牙' },
    ],
  },
  {
    key: 'category',
    labelKey: 'hotVideos.filters.category',
    options: [
      { value: 'all', labelKey: 'hotVideos.filters.all' },
      { value: 'beauty', labelKey: 'hotVideos.filters.beauty', apiValue: '美妆个护' },
      { value: 'home', labelKey: 'hotVideos.filters.home', apiValue: '居家日用' },
      { value: 'womens', labelKey: 'hotVideos.filters.womens', apiValue: '女装与女士内衣' },
      { value: 'food', labelKey: 'hotVideos.filters.food', apiValue: '食品饮料' },
      { value: 'office', labelKey: 'hotVideos.filters.office', apiValue: '电脑办公' },
    ],
  },
  {
    key: 'gmv',
    labelKey: 'hotVideos.filters.gmv',
    options: [
      { value: 'all', labelKey: 'hotVideos.filters.all' },
      { value: '1000', labelKey: 'hotVideos.filters.gmv1k' },
      { value: '5000', labelKey: 'hotVideos.filters.gmv5k' },
      { value: '10000', labelKey: 'hotVideos.filters.gmv10k' },
    ],
  },
  {
    key: 'videoType',
    labelKey: 'hotVideos.filters.videoType',
    options: [
      { value: 'all', labelKey: 'hotVideos.filters.all' },
      { value: 'ugc', labelKey: 'hotVideos.filters.ugc', apiValue: '用户原创' },
      { value: 'creator', labelKey: 'hotVideos.filters.creator', apiValue: '达人口播' },
      { value: 'review', labelKey: 'hotVideos.filters.review', apiValue: '测评种草' },
    ],
  },
  {
    key: 'published',
    labelKey: 'hotVideos.filters.published',
    options: [
      { value: '7d', labelKey: 'hotVideos.filters.sevenDays' },
      { value: '30d', labelKey: 'hotVideos.filters.thirtyDays' },
      { value: 'all', labelKey: 'hotVideos.filters.all' },
    ],
  },
];

const DEFAULT_FILTERS: Filters = {
  owner: 'all',
  region: 'all',
  category: 'all',
  gmv: 'all',
  videoType: 'all',
  published: 'all',
};

function buildQueryString(filters: Filters, query: string): string {
  const params = new URLSearchParams();
  if (filters.owner === 'me') params.set('owner', 'me');
  setMappedFilterParam(params, 'region', filters.region);
  setMappedFilterParam(params, 'category', filters.category);
  setMappedFilterParam(params, 'videoType', filters.videoType);
  if (filters.published !== 'all') params.set('published', filters.published);
  const gmvMin = filters.gmv === 'all' ? undefined : Number.parseInt(filters.gmv, 10);
  if (gmvMin !== undefined) params.set('gmvMin', String(gmvMin));
  const trimmed = query.trim();
  if (trimmed) params.set('q', trimmed);
  params.set('limit', '24');
  return params.toString();
}

function setMappedFilterParam(params: URLSearchParams, key: FilterKey, value: string) {
  if (value === 'all') return;
  const filter = FILTERS.find((item) => item.key === key);
  const option = filter?.options.find((item) => item.value === value);
  params.set(key, option?.apiValue ?? value);
}

function toView(record: HotVideoRecord, locale: Locale): HotVideoView {
  const date = new Date(record.publishedAt);
  const valid = !Number.isNaN(date.getTime());
  const daysAgo = valid
    ? Math.max(0, Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)))
    : 0;
  const publishedAtLabel = valid
    ? new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
      }).format(date)
    : '—';

  return {
    id: record.id,
    ownerUserId: record.ownerUserId,
    title: record.title,
    product: record.productName,
    category: record.category,
    region: record.region,
    videoType: record.videoType,
    publishedAt: publishedAtLabel,
    publishedDaysAgo: daysAgo,
    sales: record.metrics.sales,
    revenueUsd: record.metrics.revenueUsd,
    revenueLabel: record.metrics.revenueLabel,
    viewsCount: record.metrics.viewsCount,
    viewsLabel: record.metrics.viewsLabel,
    roas: record.metrics.roas,
    hook: record.analysis.hook,
    angle: record.analysis.angle,
    score: record.analysis.score,
    paletteCss: record.paletteCss,
    accent: record.accentColor,
    tags: record.analysis.tags,
    structure: record.analysis.structure,
    sourceUrl: record.sourceUrl,
    thumbnailUrl: record.thumbnailUrl,
    previewUrl: record.previewUrl,
  };
}

export function HotVideosPage() {
  const { locale, t } = useI18n();
  const { user } = useUser();
  const { isSignedIn, requireLogin } = useLoginRedirect();
  const currentClerkUserId = isSignedIn ? user?.id : undefined;
  const [referenceInput, setReferenceInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [inputError, setInputError] = useState<string | null>(null);
  const [parseLoading, setParseLoading] = useState(false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [videos, setVideos] = useState<HotVideoView[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [replicaTarget, setReplicaTarget] = useState<ReferenceItem | null>(null);
  const [replicaPreview, setReplicaPreview] = useState<HotVideoView | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [previewVideo, setPreviewVideo] = useState<HotVideoView | null>(null);
  const [jobsDrawerOpen, setJobsDrawerOpen] = useState(false);
  // jobId 同步到 ?job=<id> 查询参数 —— 刷新、跨设备、可分享。
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const remakeJobId = searchParams.get('job');
  const setRemakeJobId = useCallback(
    (jobId: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (jobId) params.set('job', jobId);
      else params.delete('job');
      const query = params.toString();
      router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );
  const [remakePreparing, setRemakePreparing] = useState<RemakePreparingState | null>(null);
  const generateAbortRef = useRef<AbortController | null>(null);

  const handleCancelPreparing = () => {
    generateAbortRef.current?.abort();
    generateAbortRef.current = null;
    setRemakePreparing(null);
  };

  // Debounce the local search input → appliedQuery (server param)
  useEffect(() => {
    const id = window.setTimeout(() => setAppliedQuery(searchQuery), 280);
    return () => window.clearTimeout(id);
  }, [searchQuery]);

  useEffect(() => {
    if (filters.owner === 'me' && !isSignedIn) {
      setVideos([]);
      setLoading(false);
      setLoadError(null);
      return;
    }

    const controller = new AbortController();
    setLoading(true);
    setLoadError(null);

    async function load() {
      try {
        const qs = buildQueryString(filters, appliedQuery);
        const response = await fetch(`/api/hot-videos?${qs}`, {
          signal: controller.signal,
          headers: { 'x-lumen-locale': locale },
        });
        const payload = (await response.json()) as ListHotVideosApiResponse;
        if (!response.ok || !payload.ok || !payload.data) {
          throw new Error(payload.error?.message ?? t('hotVideos.loadFailed'));
        }
        setVideos(payload.data.items.map((item) => toView(item, locale)));
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : t('hotVideos.loadFailed'));
        setVideos([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [filters, appliedQuery, isSignedIn, locale, t]);

  const totalSales = videos.reduce((sum, v) => sum + v.sales, 0);
  const avgViewsLabel = useMemo(() => {
    if (!videos.length) return '—';
    const avg = videos.reduce((sum, video) => sum + video.viewsCount, 0) / videos.length;
    return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(avg);
  }, [locale, videos]);

  const replicaVideo =
    replicaTarget?.source === 'video'
      ? videos.find((v) => v.id === replicaTarget.id)
      : (replicaPreview ?? undefined);

  const handleFilterChange = (key: FilterKey, value: string) => {
    if (key === 'owner' && value === 'me' && !requireLogin('/hot-videos')) {
      return;
    }
    setFilters((current) => ({ ...current, [key]: value }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (parseLoading) return;
    if (!requireLogin('/hot-videos')) return;

    const value = referenceInput.trim();

    if (!value) {
      setInputError(t('hotVideos.pasteLink'));
      return;
    }
    if (!isLikelyLink(value)) {
      setInputError(t('hotVideos.invalidLink'));
      return;
    }

    setInputError(null);
    setParseLoading(true);

    try {
      const response = await fetch('/api/hot-videos/parse-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-lumen-locale': locale },
        body: JSON.stringify({ url: value }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        data?: HotVideoRecord;
        error?: { message?: string };
      };

      if (!response.ok || !payload.ok || !payload.data) {
        setInputError(payload.error?.message ?? t('hotVideos.parseFailed'));
        return;
      }

      const view = toView(payload.data, locale);
      setVideos((current) => [view, ...current.filter((v) => v.id !== view.id)]);
      setReplicaPreview(view);
      setReplicaTarget(createVideoReference(view));
      setConfigOpen(true);
      setReferenceInput('');
    } catch (error) {
      setInputError(error instanceof Error ? error.message : t('hotVideos.parseFailed'));
    } finally {
      setParseLoading(false);
    }
  };

  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text.trim()) {
        setReferenceInput(text.trim());
        setInputError(null);
      }
    } catch {
      setInputError(t('hotVideos.clipboardDenied'));
    }
  };

  const startReplicaFromVideo = (video: HotVideoView) => {
    setReplicaTarget(createVideoReference(video));
    setConfigOpen(true);
  };

  const resetFilters = () => {
    setFilters(DEFAULT_FILTERS);
    setSearchQuery('');
    setReferenceInput('');
    setInputError(null);
  };

  if (remakeJobId) {
    return (
      <div className="relative min-h-screen text-white">
        <AuroraBackdrop />
        <Topbar />
        <HotVideoRemakePipeline jobId={remakeJobId} onBack={() => setRemakeJobId(null)} />
      </div>
    );
  }

  return (
    <div className="relative min-h-screen text-white">
      <AuroraBackdrop />
      <Topbar />

      <main className="relative z-10 mx-auto max-w-[1260px] px-4 pb-nav-mobile pt-24 sm:px-6 sm:pt-28">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
          className="relative overflow-hidden rounded-[22px] bg-[#17191c]/82 p-5 shadow-[0_30px_90px_-52px_rgba(0,0,0,0.9)] ring-1 ring-white/[0.08] md:p-7"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_12%,rgba(121,228,255,0.12),transparent_34%),radial-gradient(circle_at_88%_10%,rgba(245,199,106,0.12),transparent_28%)]" />

          <div className="relative text-center">
            <h1 className="font-display mx-auto max-w-[820px] text-[34px] font-extrabold leading-tight tracking-tight text-white md:text-[46px]">
              {t('hotVideos.title')}
            </h1>
            <p className="mx-auto mt-3 max-w-[760px] text-[14px] leading-7 text-white/52">
              {t('hotVideos.subtitle')}
            </p>

            <form
              onSubmit={handleSubmit}
              className="mx-auto mt-7 max-w-[980px] overflow-hidden rounded-[18px] bg-[#111315]/86 text-left ring-1 ring-white/[0.09]"
            >
              <div className="flex min-h-[52px] flex-wrap items-center gap-2 px-3 py-2 sm:min-h-[58px] sm:flex-nowrap sm:gap-3 sm:px-4 sm:py-0">
                <IconLink size={18} className="shrink-0 text-white/42" stroke={2.2} />
                <input
                  value={referenceInput}
                  onChange={(event) => {
                    setReferenceInput(event.target.value);
                    if (inputError) setInputError(null);
                  }}
                  disabled={parseLoading}
                  placeholder={t('hotVideos.inputPlaceholder')}
                  className="min-h-11 min-w-0 flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-white/30 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={pasteFromClipboard}
                  disabled={parseLoading}
                  className="hidden h-10 items-center gap-1.5 rounded-xl bg-white/[0.055] px-3 text-[12px] font-semibold text-white/58 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.09] hover:text-white disabled:opacity-60 sm:flex"
                >
                  <IconCopyPlus size={15} stroke={2.2} />
                  {t('hotVideos.paste')}
                </button>
                <button
                  type="submit"
                  disabled={parseLoading}
                  className="flex min-h-11 items-center gap-1.5 rounded-xl bg-white px-4 text-[13px] font-bold text-[#111315] shadow-[0_14px_34px_-22px_rgba(255,255,255,0.9)] transition-transform active:scale-[0.97] disabled:cursor-wait disabled:opacity-70"
                >
                  {parseLoading ? (
                    <>
                      <IconLoader2 size={15} className="animate-spin" stroke={2.4} />
                      {t('hotVideos.parsing')}
                    </>
                  ) : (
                    <>
                      {t('hotVideos.parse')}
                      <IconArrowRight size={15} stroke={2.5} />
                    </>
                  )}
                </button>
              </div>
              {inputError ? (
                <div className="border-t border-white/[0.06] px-4 py-2 text-[12px] text-[#f5c76a]">
                  {inputError}
                </div>
              ) : null}
            </form>
          </div>
        </motion.section>

        <section className="mt-5">
          <div className="flex flex-wrap items-center gap-2">
            {FILTERS.map((filter) => (
              <FilterPill
                key={filter.key}
                filter={filter}
                value={filters[filter.key]}
                onChange={(value) => handleFilterChange(filter.key, value)}
              />
            ))}

            <button
              type="button"
              onClick={() => {
                if (!requireLogin('/hot-videos')) return;
                setJobsDrawerOpen(true);
              }}
              className="ml-auto flex min-h-11 items-center gap-1.5 rounded-full bg-[#79e4ff]/12 px-3 text-[13px] font-semibold text-[#79e4ff] ring-1 ring-[#79e4ff]/22 transition-colors hover:bg-[#79e4ff]/22"
            >
              <IconHistory size={13} stroke={2.4} />
              {t('hotVideos.myJobs')}
            </button>
            <button
              type="button"
              onClick={resetFilters}
              className="flex min-h-11 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-[#ff5fbf] transition-colors hover:bg-[#ff5fbf]/10"
            >
              <IconRefresh size={13} stroke={2.4} />
              {t('common.resetFilters')}
            </button>
          </div>
        </section>

        <section className="mt-5">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <h2 className="text-[18px] font-bold text-white">{t('hotVideos.hotRefs')}</h2>
              <div className="mt-1 text-[12px] text-white/35">
                {loading
                  ? `${t('hotVideos.loading')}...`
                  : t('hotVideos.resultsMeta', {
                      count: videos.length,
                      sales: totalSales.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US'),
                      views: avgViewsLabel,
                    })}
              </div>
            </div>
            <label className="ml-auto flex min-h-11 w-full min-w-0 items-center gap-2 rounded-xl bg-[#141619] px-3 ring-1 ring-white/[0.08] sm:w-auto sm:min-w-[260px]">
              <IconSearch size={16} className="text-white/38" stroke={2.1} />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder={t('hotVideos.searchPlaceholder')}
                className="min-h-11 min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/30"
              />
            </label>
          </div>

          {loadError ? (
            <div className="rounded-[18px] bg-[#1c1e20] p-6 text-[13px] text-[#f5c76a] ring-1 ring-white/[0.07]">
              {t('hotVideos.loadFailed')}: {loadError}
            </div>
          ) : loading && videos.length === 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: HOT_VIDEO_SKELETON_COUNT }).map((_, index) => (
                // biome-ignore lint/suspicious/noArrayIndexKey: 同质骨架占位卡，index 作为 key 不会引发 reorder 问题。
                <HotVideoCardSkeleton key={`hot-video-skeleton-${index}`} />
              ))}
            </div>
          ) : videos.length === 0 ? (
            <div className="rounded-[18px] bg-[#1c1e20] p-10 text-center text-[13px] text-white/48 ring-1 ring-white/[0.07]">
              {filters.owner === 'me' ? t('hotVideos.emptyMine') : t('hotVideos.empty')}
            </div>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {videos.map((video, index) => (
                <HotVideoCard
                  key={video.id}
                  index={index}
                  video={video}
                  signedIn={isSignedIn}
                  ownedByMe={Boolean(
                    currentClerkUserId && video.ownerUserId === currentClerkUserId,
                  )}
                  onRequireLogin={() => requireLogin('/hot-videos')}
                  onUse={() => startReplicaFromVideo(video)}
                  onPreview={() => setPreviewVideo(video)}
                />
              ))}
            </div>
          )}
        </section>
      </main>

      {configOpen && replicaTarget ? (
        <div className={cn(remakePreparing && 'hidden')}>
          <ReplicaConfigModal
            target={replicaTarget}
            video={replicaVideo}
            generateAbortRef={generateAbortRef}
            onGenerateStart={(uploadTotal) =>
              setRemakePreparing({ phase: 'upload', uploadCurrent: 0, uploadTotal })
            }
            onGenerateProgress={(update) =>
              setRemakePreparing((prev) => (prev ? { ...prev, ...update } : prev))
            }
            onGenerateError={() => setRemakePreparing(null)}
            onStart={(jobId) => {
              setRemakePreparing(null);
              setRemakeJobId(jobId);
              setConfigOpen(false);
            }}
            onClose={() => setConfigOpen(false)}
          />
        </div>
      ) : null}

      {remakePreparing ? (
        <RemakePreparingScreen state={remakePreparing} onCancel={handleCancelPreparing} />
      ) : null}

      {previewVideo ? (
        <VideoPreviewModal video={previewVideo} onClose={() => setPreviewVideo(null)} />
      ) : null}

      <RemakeJobsDrawer
        open={jobsDrawerOpen}
        onClose={() => setJobsDrawerOpen(false)}
        onResume={(jobId) => {
          setJobsDrawerOpen(false);
          setRemakeJobId(jobId);
        }}
      />
    </div>
  );
}

/** 初次加载爆款视频时铺一层骨架卡，xl 4 列下正好 2 行。 */
const HOT_VIDEO_SKELETON_COUNT = 8;

/**
 * 爆款卡片骨架：撑住 3:4 缩略图 + 顶部 tag + 底部标题/数据三段区域，
 * 与真实 HotVideoCard 的视觉轮廓一致，数据到位后切换几乎不跳。
 */
function HotVideoCardSkeleton() {
  return (
    <article
      className="overflow-hidden rounded-[18px] bg-[#1c1e20] ring-1 ring-white/[0.07]"
      aria-hidden="true"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden">
        <div className="lumen-skeleton absolute inset-0" />
        <div className="pointer-events-none absolute left-3 top-3 flex gap-1.5">
          <div className="lumen-skeleton h-6 w-14 rounded-full" />
          <div className="lumen-skeleton h-6 w-10 rounded-full" />
        </div>
        <div className="pointer-events-none absolute inset-x-3 bottom-3 space-y-2">
          <div className="lumen-skeleton h-3.5 w-[78%] rounded" />
          <div className="lumen-skeleton h-3 w-[48%] rounded" />
        </div>
      </div>
      <div className="flex items-center gap-2 px-4 py-3">
        <div className="lumen-skeleton h-8 w-8 shrink-0 rounded-full" />
        <div className="lumen-skeleton h-3 w-[60%] rounded" />
        <div className="lumen-skeleton ml-auto h-3 w-8 rounded" />
      </div>
    </article>
  );
}

function HotVideoCard({
  video,
  index,
  ownedByMe,
  signedIn,
  onRequireLogin,
  onUse,
  onPreview,
}: {
  video: HotVideoView;
  index: number;
  ownedByMe: boolean;
  signedIn: boolean;
  onRequireLogin: () => boolean;
  onUse: () => void;
  onPreview: () => void;
}) {
  const { locale, t } = useI18n();
  const [playPreview, setPlayPreview] = useState(false);
  const startPreview = () => {
    if (video.previewUrl) setPlayPreview(true);
  };
  const stopPreview = () => setPlayPreview(false);
  const stop = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay: index * 0.035, ease: [0.32, 0.72, 0, 1] }}
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
      className="group overflow-hidden rounded-[18px] bg-[#1c1e20] ring-1 ring-white/[0.07] transition-colors hover:bg-[#222528]"
    >
      <div className="relative aspect-[3/4] w-full overflow-hidden bg-black text-left">
        <button
          type="button"
          onClick={() => {
            stopPreview();
            onPreview();
          }}
          aria-label={t('hotVideos.originalPreview')}
          className="absolute inset-0 text-left focus:outline-none"
        >
          <VideoStill video={video} autoPlay={playPreview} muted={playPreview} />
        </button>

        <div className="pointer-events-none absolute left-3 top-3 flex flex-wrap gap-1.5">
          <span
            className="rounded-full px-2.5 py-1 text-[11px] font-bold text-[#111315]"
            style={{ background: video.accent }}
          >
            {video.category}
          </span>
          <span className="rounded-full bg-black/42 px-2.5 py-1 text-[11px] font-semibold text-white/82 backdrop-blur">
            {video.videoType}
          </span>
        </div>
        <div className="pointer-events-none absolute right-3 top-3 flex items-center gap-2">
          <span
            className={cn(
              'flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold backdrop-blur',
              ownedByMe
                ? 'bg-[#79e4ff]/22 text-[#79e4ff] ring-1 ring-[#79e4ff]/32'
                : 'bg-black/36 text-white/74',
            )}
            title={
              ownedByMe ? t('hotVideos.card.downloaded') : t('hotVideos.card.downloadedByOthers')
            }
          >
            <IconHeart size={14} fill={ownedByMe ? 'currentColor' : 'none'} stroke={2.2} />
            {ownedByMe ? t('hotVideos.card.downloaded') : null}
          </span>
        </div>
        {!video.previewUrl ? (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.82))] px-3 pb-3 pt-16">
            <div className="line-clamp-2 text-[13px] font-bold leading-5 text-white">
              {video.title}
            </div>
            <div className="mt-1 flex items-center gap-1.5 text-[11px] text-white/52">
              <IconCalendar size={12} stroke={2.1} />
              {video.publishedAt}
            </div>
          </div>
        ) : null}
      </div>

      <div className="space-y-3 p-3.5">
        <div className="grid grid-cols-2 gap-2">
          <CardStat
            icon={<IconShoppingBag size={13} stroke={2.2} />}
            label={t('hotVideos.card.sales')}
            value={video.sales}
            locale={locale}
          />
          <CardStat
            icon={<IconTrendingUp size={13} stroke={2.2} />}
            label={t('hotVideos.card.revenue')}
            value={video.revenueLabel}
            locale={locale}
          />
          <CardStat
            icon={<IconEye size={13} stroke={2.2} />}
            label={t('hotVideos.card.views')}
            value={video.viewsLabel}
            locale={locale}
          />
          <CardStat
            icon={<IconFlame size={13} stroke={2.2} />}
            label="ROAS"
            value={video.roas}
            locale={locale}
          />
        </div>

        <button
          type="button"
          onClick={(event) => {
            stop(event);
            if (!signedIn) {
              onRequireLogin();
              return;
            }
            stopPreview();
            onUse();
          }}
          title={!signedIn ? t('hotVideos.card.signupTitle') : t('hotVideos.card.remixTitle')}
          className={cn(
            'flex h-9 w-full items-center justify-center gap-1.5 rounded-xl text-[12px] font-semibold transition-colors',
            signedIn
              ? 'bg-white/[0.075] text-white/82 ring-1 ring-white/[0.06] hover:bg-white hover:text-[#111315]'
              : 'bg-white/[0.055] text-white/62 ring-1 ring-white/[0.05] hover:bg-white hover:text-[#111315]',
          )}
        >
          {signedIn ? (
            <>
              <IconCheck size={14} stroke={2.4} />
              {t('hotVideos.card.remix')}
            </>
          ) : (
            <>
              <IconLock size={13} stroke={2.4} />
              {t('hotVideos.card.signupRemix')}
            </>
          )}
        </button>
      </div>
    </motion.article>
  );
}

function VideoPreviewModal({
  video,
  onClose,
}: {
  video: HotVideoView;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/82 px-5 py-8 backdrop-blur-xl"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape' || event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          onClose();
        }
      }}
      role="presentation"
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.24, ease: [0.32, 0.72, 0, 1] }}
        onClick={(event) => event.stopPropagation()}
        className="relative flex max-h-[92vh] w-full max-w-[420px] flex-col overflow-hidden rounded-[20px] bg-[#0b0d10] shadow-[0_34px_110px_-42px_rgba(0,0,0,0.95)] ring-1 ring-white/[0.1]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-xl bg-black/52 text-white/72 ring-1 ring-white/[0.1] backdrop-blur transition-colors hover:bg-black/72 hover:text-white"
        >
          <IconX size={18} stroke={2.2} />
        </button>

        <div className="relative aspect-[9/16] w-full bg-black">
          {video.previewUrl ? (
            <video
              ref={videoRef}
              src={video.previewUrl}
              poster={video.thumbnailUrl}
              autoPlay
              loop
              playsInline
              controls
              muted
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : video.thumbnailUrl ? (
            <img
              src={video.thumbnailUrl}
              alt={video.title}
              referrerPolicy="no-referrer"
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-[13px] text-white/45">
              {t('hotVideos.previewUnavailable')}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-white/[0.06] px-5 py-4">
          <div className="text-[14px] font-bold leading-6 text-white">{video.title}</div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-white/52">
            <span>{video.publishedAt}</span>
            <span className="opacity-40">·</span>
            <span>{video.region}</span>
            <span className="opacity-40">·</span>
            <span>
              {t('hotVideos.card.views')} {video.viewsLabel}
            </span>
            {video.sourceUrl ? (
              <a
                href={video.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-[#79e4ff] hover:text-white"
              >
                <IconExternalLink size={13} stroke={2.2} />
                {t('hotVideos.openOriginal')}
              </a>
            ) : null}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function RemakePreparingScreen({
  state,
  onCancel,
}: {
  state: RemakePreparingState;
  onCancel: () => void;
}) {
  const { t } = useI18n();
  const uploadActive = state.phase === 'upload';
  const uploadLabel =
    uploadActive && state.uploadTotal > 1
      ? t('hotVideos.preparing.stepUploadProgress', {
          current: Math.min(state.uploadCurrent + 1, state.uploadTotal),
          total: state.uploadTotal,
        })
      : t('hotVideos.preparing.stepUpload');

  return (
    <div className="fixed inset-0 z-[75] flex items-center justify-center bg-[#0a0b0c]/96 px-5 py-8 backdrop-blur-2xl">
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.32, ease: [0.32, 0.72, 0, 1] }}
        className="relative flex w-full max-w-[520px] flex-col items-center overflow-hidden rounded-[22px] bg-[#111315] p-10 text-center shadow-[0_34px_110px_-42px_rgba(0,0,0,0.95)] ring-1 ring-white/[0.08]"
      >
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[220px] bg-[radial-gradient(circle_at_50%_0%,rgba(157,168,255,0.22),transparent_64%)]"
        />

        <button
          type="button"
          onClick={onCancel}
          aria-label={t('common.close')}
          className="absolute right-4 top-4 z-10 flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.055] text-white/52 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.1] hover:text-white"
        >
          <IconX size={16} stroke={2.2} />
        </button>

        <div className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-[#9da8ff]/16 text-[#9da8ff] ring-1 ring-[#9da8ff]/22">
          <IconLoader2 size={28} className="animate-spin" stroke={2.4} />
        </div>

        <h2 className="relative mt-6 text-[20px] font-bold text-white">
          {t('hotVideos.preparing.title')}
        </h2>
        <p className="relative mt-3 max-w-[420px] text-[13px] leading-6 text-white/52">
          {t('hotVideos.preparing.subtitle')}
        </p>

        <div className="relative mt-7 w-full space-y-2.5 text-left">
          <PreparingStep label={uploadLabel} status={uploadActive ? 'active' : 'done'} />
          <PreparingStep
            label={t('hotVideos.preparing.stepRemake')}
            status={state.phase === 'remake' ? 'active' : 'pending'}
          />
        </div>
      </motion.div>
    </div>
  );
}

function SettingPicker<T extends string>({
  label,
  value,
  options,
  formatValue,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly T[];
  formatValue?: (value: T) => string;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const display = formatValue ? formatValue(value) : value;

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          'flex h-12 w-full items-center justify-between rounded-xl bg-white/[0.045] px-4 text-left ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.075]',
          open && 'bg-white/[0.075] ring-white/[0.16]',
        )}
      >
        <span className="text-[12px] text-white/38">{label}</span>
        <span className="flex items-center gap-1.5 text-[13px] font-bold text-white">
          {display}
          <IconSelector size={13} stroke={2.2} className="text-white/40" />
        </span>
      </button>
      {open ? (
        <motion.div
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
          className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 flex flex-col gap-0.5 overflow-hidden rounded-xl bg-[#1c1d1f] p-1 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.92)] ring-1 ring-white/[0.08]"
        >
          {options.map((option) => {
            const isSelected = option === value;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange(option);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-[13px] transition-colors',
                  isSelected
                    ? 'bg-white/[0.08] text-white'
                    : 'text-white/72 hover:bg-white/[0.05] hover:text-white',
                )}
              >
                <span className="font-medium">{formatValue ? formatValue(option) : option}</span>
                {isSelected ? (
                  <IconCheck size={14} stroke={2.6} className="text-[#9da8ff]" />
                ) : null}
              </button>
            );
          })}
        </motion.div>
      ) : null}
    </div>
  );
}

function PreparingStep({
  label,
  status,
}: {
  label: string;
  status: 'pending' | 'active' | 'done';
}) {
  return (
    <div
      className={cn(
        'flex items-center gap-3 rounded-xl px-3.5 py-2.5 text-[13px] ring-1 transition-colors',
        status === 'active' && 'bg-white/[0.05] text-white ring-white/[0.1]',
        status === 'done' && 'text-white/55 ring-white/[0.06]',
        status === 'pending' && 'text-white/35 ring-white/[0.05]',
      )}
    >
      <span
        className={cn(
          'flex h-6 w-6 items-center justify-center rounded-full',
          status === 'active' && 'bg-[#9da8ff]/22 text-[#9da8ff]',
          status === 'done' && 'bg-[#3ae08a]/16 text-[#3ae08a]',
          status === 'pending' && 'bg-white/[0.05] text-white/40',
        )}
      >
        {status === 'active' ? (
          <IconLoader2 size={13} className="animate-spin" stroke={2.4} />
        ) : status === 'done' ? (
          <IconCheck size={13} stroke={2.6} />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
        )}
      </span>
      <span className="font-medium">{label}</span>
    </div>
  );
}

function ReplicaConfigModal({
  target,
  video,
  generateAbortRef,
  onGenerateStart,
  onGenerateProgress,
  onGenerateError,
  onStart,
  onClose,
}: {
  target: ReferenceItem;
  video?: HotVideoView;
  generateAbortRef: React.MutableRefObject<AbortController | null>;
  onGenerateStart: (uploadTotal: number) => void;
  onGenerateProgress: (update: {
    phase: 'upload' | 'remake';
    uploadCurrent: number;
  }) => void;
  onGenerateError: (message: string) => void;
  onStart: (jobId: string) => void;
  onClose: () => void;
}) {
  const { locale, t } = useI18n();
  const fileInputId = useId();
  const creatorFileInputId = useId();
  const [uploadedImages, setUploadedImages] = useState<UploadedProductImage[]>([]);
  const [creatorImages, setCreatorImages] = useState<UploadedProductImage[]>([]);
  const [prompt, setPrompt] = useState('');
  const [generating, setGenerating] = useState(false);
  const [generateError, setGenerateError] = useState<string | null>(null);
  const [aspectRatio, setAspectRatio] = useState<AspectRatioOption>('9:16');
  const [duration, setDuration] = useState<DurationOption>('15s');
  const [copyLanguage, setCopyLanguage] = useState<CopyLanguageOption>(locale);
  const [resolution, setResolution] = useState<ResolutionOption>('720p');
  const uploadedImagesRef = useRef(uploadedImages);
  const creatorImagesRef = useRef(creatorImages);
  const canGenerate = uploadedImages.length > 0 && !generating;

  useEffect(() => {
    uploadedImagesRef.current = uploadedImages;
  }, [uploadedImages]);

  useEffect(() => {
    creatorImagesRef.current = creatorImages;
  }, [creatorImages]);

  useEffect(() => {
    return () => {
      for (const image of uploadedImagesRef.current) {
        URL.revokeObjectURL(image.previewUrl);
      }
      for (const image of creatorImagesRef.current) {
        URL.revokeObjectURL(image.previewUrl);
      }
    };
  }, []);

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const availableSlots = 9 - uploadedImages.length;
    const nextImages = files.slice(0, availableSlots).map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${index}`,
      name: file.name,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    if (nextImages.length) {
      setUploadedImages((current) => [...current, ...nextImages]);
    }

    event.currentTarget.value = '';
  };

  const handleCreatorUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const availableSlots = 2 - creatorImages.length;
    const nextImages = files.slice(0, availableSlots).map((file, index) => ({
      id: `creator-${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${index}`,
      name: file.name,
      file,
      previewUrl: URL.createObjectURL(file),
    }));

    if (nextImages.length) {
      setCreatorImages((current) => [...current, ...nextImages]);
    }

    event.currentTarget.value = '';
  };

  const removeImage = (imageId: string) => {
    setUploadedImages((current) => {
      const targetImage = current.find((image) => image.id === imageId);
      if (targetImage) URL.revokeObjectURL(targetImage.previewUrl);
      return current.filter((image) => image.id !== imageId);
    });
  };

  const removeCreatorImage = (imageId: string) => {
    setCreatorImages((current) => {
      const targetImage = current.find((image) => image.id === imageId);
      if (targetImage) URL.revokeObjectURL(targetImage.previewUrl);
      return current.filter((image) => image.id !== imageId);
    });
  };

  const uploadOneImage = async (
    image: UploadedProductImage,
    nodeId: string,
    setter: (id: string, url: string) => void,
    signal?: AbortSignal,
  ) => {
    if (image.uploadedUrl) return image.uploadedUrl;
    const form = new FormData();
    form.set('file', image.file);
    form.set('kind', 'image');
    form.set('nodeId', nodeId);

    const response = await fetch('/api/canvas/uploads', {
      method: 'POST',
      headers: { 'x-lumen-locale': locale },
      body: form,
      signal,
    });
    const payload = (await response.json()) as CanvasUploadApiResponse;
    if (!response.ok || !payload.ok || !payload.data) {
      throw new Error(payload.error?.message ?? t('materials.uploadFailed'));
    }
    const uploadedUrl = payload.data.asset.url;
    setter(image.id, uploadedUrl);
    return uploadedUrl;
  };

  const handleGenerate = async () => {
    if (!canGenerate) return;
    const controller = new AbortController();
    generateAbortRef.current = controller;
    setGenerating(true);
    setGenerateError(null);
    const totalToUpload = uploadedImages.length + creatorImages.length;
    onGenerateStart(totalToUpload);
    try {
      const productImageUrls: string[] = [];
      for (const [index, image] of uploadedImages.entries()) {
        if (controller.signal.aborted) return;
        onGenerateProgress({ phase: 'upload', uploadCurrent: index });
        productImageUrls.push(
          await uploadOneImage(
            image,
            `hot-remake-product-${index + 1}`,
            (id, url) =>
              setUploadedImages((cur) =>
                cur.map((item) => (item.id === id ? { ...item, uploadedUrl: url } : item)),
              ),
            controller.signal,
          ),
        );
      }
      const creatorImageUrls: string[] = [];
      for (const [index, image] of creatorImages.entries()) {
        if (controller.signal.aborted) return;
        onGenerateProgress({
          phase: 'upload',
          uploadCurrent: uploadedImages.length + index,
        });
        creatorImageUrls.push(
          await uploadOneImage(
            image,
            `hot-remake-creator-${index + 1}`,
            (id, url) =>
              setCreatorImages((cur) =>
                cur.map((item) => (item.id === id ? { ...item, uploadedUrl: url } : item)),
              ),
            controller.signal,
          ),
        );
      }
      if (controller.signal.aborted) return;
      onGenerateProgress({
        phase: 'remake',
        uploadCurrent: totalToUpload,
      });

      // 新 API：/api/remake/jobs 创建 Job（含同步拆解 + plan）。
      // 返回 RemakeJobView = { job, tasks, stageStatuses }；只取 job.id 给 Pipeline 用。
      const response = await fetch('/api/remake/jobs', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-lumen-locale': locale,
        },
        body: JSON.stringify({
          videoId: video?.id ?? (target.source === 'video' ? target.id : undefined),
          reference: target,
          productImageUrls,
          ...(creatorImageUrls.length ? { creatorImageUrls } : {}),
          userPrompt: prompt || undefined,
          settings: {
            aspectRatio,
            resolution,
            language: copyLanguage,
            durationSeconds: Number.parseInt(duration, 10),
          },
        }),
        signal: controller.signal,
      });
      const payload = (await response.json()) as CreateRemakeJobResponse;
      if (controller.signal.aborted) return;
      if (!response.ok || !payload.ok || !payload.data?.job?.id) {
        throw new Error(payload.error?.message ?? t('hotVideos.parseFailed'));
      }
      onStart(payload.data.job.id);
    } catch (error) {
      if (
        controller.signal.aborted ||
        (error instanceof DOMException && error.name === 'AbortError')
      ) {
        return;
      }
      const message = error instanceof Error ? error.message : t('hotVideos.parseFailed');
      setGenerateError(message);
      onGenerateError(message);
    } finally {
      if (generateAbortRef.current === controller) {
        generateAbortRef.current = null;
      }
      setGenerating(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/72 px-5 py-8 backdrop-blur-xl">
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.28, ease: [0.32, 0.72, 0, 1] }}
        className="relative flex max-h-[86vh] w-full max-w-[1020px] flex-col overflow-hidden rounded-[18px] bg-[#111315] shadow-[0_34px_110px_-42px_rgba(0,0,0,0.95)] ring-1 ring-white/[0.1]"
      >
        <button
          type="button"
          onClick={onClose}
          aria-label={t('common.close')}
          className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.055] text-white/52 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.1] hover:text-white"
        >
          <IconX size={18} stroke={2.2} />
        </button>

        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-[320px_minmax(0,1fr)]">
          <section className="border-b border-white/[0.07] p-6 lg:border-b-0 lg:border-r">
            <div className="text-[12px] font-semibold text-white/42">
              {t('hotVideos.originalPreview')}
            </div>
            <div className="mt-4 flex justify-center lg:justify-start">
              <div className="relative aspect-[9/16] w-full max-w-[264px] overflow-hidden rounded-[18px] bg-black ring-1 ring-white/[0.08]">
                {video ? (
                  <VideoStill video={video} autoPlay muted />
                ) : (
                  <LinkReplicaPreview target={target} />
                )}
                <div className="absolute left-4 top-4 flex items-center gap-2">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white/12 text-white ring-1 ring-white/12">
                    <IconPlayerPlay size={16} stroke={2.2} />
                  </span>
                  <div>
                    <div className="max-w-[168px] truncate text-[13px] font-bold text-white">
                      {target.label}
                    </div>
                    <div className="mt-0.5 text-[11px] text-white/45">
                      {target.source === 'link' ? t('hotVideos.externalLink') : video?.region}
                    </div>
                  </div>
                </div>
                <div className="absolute inset-x-4 bottom-4 rounded-xl bg-black/36 px-3 py-2 text-[12px] leading-5 text-white/72 backdrop-blur">
                  {target.value}
                </div>
              </div>
            </div>
          </section>

          <section className="p-6 pr-14">
            <div className="flex items-start gap-3">
              <div>
                <h2 className="text-[20px] font-bold text-white">{t('hotVideos.configTitle')}</h2>
                <p className="mt-1 text-[13px] text-white/42">{t('hotVideos.configSubtitle')}</p>
              </div>
            </div>

            <div className="mt-7">
              <div className="flex items-center gap-2 text-[14px] font-bold text-white">
                {t('hotVideos.uploadProduct')}
                <span className="text-[#f5c76a]">*</span>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-white/38">{t('hotVideos.uploadTip')}</p>

              <input
                id={fileInputId}
                type="file"
                accept="image/*"
                multiple
                onChange={handleUpload}
                className="sr-only"
              />

              <div className="mt-4 flex flex-wrap gap-3">
                <label
                  htmlFor={fileInputId}
                  className={cn(
                    'flex h-[88px] w-[88px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/16 bg-white/[0.045] text-[11px] font-semibold text-white/46 transition-colors hover:border-[#79e4ff]/48 hover:bg-[#79e4ff]/8 hover:text-white',
                    uploadedImages.length >= 9 && 'pointer-events-none opacity-45',
                  )}
                >
                  <IconPlus size={22} stroke={2.2} />
                  {t('common.upload')}
                </label>

                {uploadedImages.map((image) => (
                  <div
                    key={image.id}
                    className="relative h-[88px] w-[88px] overflow-hidden rounded-xl bg-white/[0.06] ring-1 ring-white/[0.08]"
                  >
                    <img
                      src={image.previewUrl}
                      alt={image.name}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 line-clamp-2 bg-black/58 px-1.5 py-1 text-center text-[9px] leading-3 text-white/78 backdrop-blur">
                      {image.name}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeImage(image.id)}
                      disabled={generating}
                      aria-label={`${t('common.remove')} ${image.name}`}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/62 text-white/68 ring-1 ring-white/[0.12] hover:text-white disabled:opacity-40"
                    >
                      <IconX size={13} stroke={2.2} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3 text-[12px] text-white/36">
                {t('hotVideos.uploaded', { count: uploadedImages.length })}
              </div>
            </div>

            <div className="mt-6">
              <div className="text-[14px] font-bold text-white">{t('hotVideos.uploadCreator')}</div>
              <p className="mt-2 text-[12px] leading-5 text-white/38">
                {t('hotVideos.uploadCreatorTip')}
              </p>

              <input
                id={creatorFileInputId}
                type="file"
                accept="image/*"
                multiple
                onChange={handleCreatorUpload}
                className="sr-only"
              />

              <div className="mt-4 flex flex-wrap gap-3">
                <label
                  htmlFor={creatorFileInputId}
                  className={cn(
                    'flex h-[88px] w-[88px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-white/16 bg-white/[0.045] text-[11px] font-semibold text-white/46 transition-colors hover:border-[#9da8ff]/48 hover:bg-[#9da8ff]/8 hover:text-white',
                    creatorImages.length >= 2 && 'pointer-events-none opacity-45',
                  )}
                >
                  <IconPlus size={22} stroke={2.2} />
                  {t('common.upload')}
                </label>

                {creatorImages.map((image) => (
                  <div
                    key={image.id}
                    className="relative h-[88px] w-[88px] overflow-hidden rounded-xl bg-white/[0.06] ring-1 ring-[#9da8ff]/22"
                  >
                    <img
                      src={image.previewUrl}
                      alt={image.name}
                      className="h-full w-full object-cover"
                    />
                    <div className="absolute inset-x-0 bottom-0 line-clamp-2 bg-black/58 px-1.5 py-1 text-center text-[9px] leading-3 text-white/78 backdrop-blur">
                      {image.name}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeCreatorImage(image.id)}
                      disabled={generating}
                      aria-label={`${t('common.remove')} ${image.name}`}
                      className="absolute right-1 top-1 flex h-6 w-6 items-center justify-center rounded-full bg-black/62 text-white/68 ring-1 ring-white/[0.12] hover:text-white disabled:opacity-40"
                    >
                      <IconX size={13} stroke={2.2} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3 text-[12px] text-white/36">
                {t('hotVideos.uploadedCreator', { count: creatorImages.length })}
              </div>
            </div>

            <div className="mt-6">
              <label htmlFor="replica-prompt" className="text-[14px] font-bold text-white">
                {t('hotVideos.promptLabel')}
              </label>
              <textarea
                id="replica-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={t('hotVideos.promptPlaceholder')}
                className="mt-3 h-[112px] w-full resize-none rounded-xl bg-white/[0.045] px-4 py-3 text-[13px] leading-6 text-white outline-none ring-1 ring-white/[0.08] placeholder:text-white/28 focus:ring-[#79e4ff]/34"
              />
            </div>

            <div className="mt-6">
              <div className="flex items-center gap-2 text-[14px] font-bold text-white">
                <IconSettings size={16} stroke={2.2} />
                {t('hotVideos.videoSettings')}
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <SettingPicker
                  label={t('hotVideos.settings.aspect')}
                  value={aspectRatio}
                  options={ASPECT_RATIO_OPTIONS}
                  onChange={setAspectRatio}
                />
                <SettingPicker
                  label={t('hotVideos.settings.duration')}
                  value={duration}
                  options={DURATION_OPTIONS}
                  onChange={setDuration}
                />
                <SettingPicker
                  label={t('hotVideos.settings.copyLanguage')}
                  value={copyLanguage}
                  options={COPY_LANGUAGE_OPTIONS}
                  formatValue={(value) =>
                    value === 'zh'
                      ? t('hotVideos.settings.chinese')
                      : t('hotVideos.settings.english')
                  }
                  onChange={setCopyLanguage}
                />
                <SettingPicker
                  label={t('hotVideos.settings.quality')}
                  value={resolution}
                  options={RESOLUTION_OPTIONS}
                  onChange={setResolution}
                />
              </div>
            </div>
          </section>
        </div>

        {generateError ? (
          <div className="border-t border-white/[0.08] px-6 py-3 text-[12px] leading-5 text-[#f5c76a]">
            {generateError}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.08] px-6 py-4">
          <div className="text-[12px] text-white/38">{t('hotVideos.generationTime')}</div>
          <button
            type="button"
            onClick={handleGenerate}
            disabled={!canGenerate}
            className={cn(
              'ml-auto flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-[13px] font-bold transition-transform active:scale-[0.98]',
              canGenerate
                ? 'bg-white text-[#111315]'
                : 'bg-white/[0.08] text-white/42 ring-1 ring-white/[0.07]',
            )}
          >
            {generating ? (
              <IconLoader2 size={15} className="animate-spin" stroke={2.3} />
            ) : (
              <IconUpload size={15} stroke={2.3} />
            )}
            {generating ? t('hotVideos.generating') : t('hotVideos.generate')}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

function LinkReplicaPreview({ target }: { target: ReferenceItem }) {
  return (
    <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(121,228,255,0.34),transparent_34%),linear-gradient(145deg,#14181d,#2b3340_52%,#090b0d)]">
      <div className="absolute inset-0 opacity-50 mix-blend-overlay [background-image:linear-gradient(120deg,transparent_18%,rgba(255,255,255,0.28)_48%,transparent_68%)]" />
      <div className="absolute left-1/2 top-1/2 flex h-24 w-24 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white/[0.08] text-white/58 ring-1 ring-white/[0.12]">
        <IconExternalLink size={34} stroke={1.9} />
      </div>
      <div className="absolute bottom-[30%] left-[14%] right-[14%] rounded-xl bg-black/28 px-3 py-2 text-center text-[11px] text-white/46 ring-1 ring-white/[0.08]">
        {target.label}
      </div>
    </div>
  );
}

function VideoStill({
  video,
  autoPlay = false,
  controls = false,
  muted = false,
}: {
  video: HotVideoView;
  autoPlay?: boolean;
  controls?: boolean;
  muted?: boolean;
}) {
  const hasVideo = Boolean(video.previewUrl);
  const cover = video.thumbnailUrl;

  if (hasVideo && (autoPlay || controls)) {
    return (
      <div className="absolute inset-0" style={{ background: video.paletteCss }}>
        <video
          src={video.previewUrl}
          poster={cover}
          autoPlay={autoPlay}
          controls={controls}
          loop={autoPlay && !controls}
          muted={muted}
          playsInline
          preload="metadata"
          className="absolute inset-0 h-full w-full object-cover"
        >
          <track kind="captions" />
        </video>
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.05)_0%,transparent_30%,rgba(0,0,0,0.45)_100%)]" />
      </div>
    );
  }

  if (cover) {
    return (
      <div className="absolute inset-0" style={{ background: video.paletteCss }}>
        <img
          src={cover}
          alt={video.title}
          decoding="async"
          loading="lazy"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.05)_0%,transparent_30%,rgba(0,0,0,0.45)_100%)]" />
        <div className="absolute left-5 top-[45%] flex h-10 w-10 items-center justify-center rounded-full bg-white/82 text-[#111315] opacity-0 shadow-[0_10px_34px_-18px_rgba(255,255,255,0.9)] transition-opacity group-hover:opacity-100">
          <IconPlayerPlay size={16} fill="currentColor" stroke={1.5} />
        </div>
      </div>
    );
  }

  return (
    <div className="absolute inset-0" style={{ background: video.paletteCss }}>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_18%,rgba(255,255,255,0.22),transparent_18%),linear-gradient(180deg,rgba(255,255,255,0.08),transparent_44%,rgba(0,0,0,0.45))]" />
      <div className="absolute left-[16%] top-[22%] h-[42%] w-[31%] rounded-[18px] bg-white/18 shadow-[0_18px_42px_-22px_rgba(0,0,0,0.8)] ring-1 ring-white/20 backdrop-blur-sm" />
      <div className="absolute right-[13%] top-[28%] h-[28%] w-[34%] rounded-full bg-black/28 ring-1 ring-white/12" />
      <div className="absolute bottom-[23%] left-[12%] right-[12%] h-[12%] rounded-xl bg-white/16 ring-1 ring-white/14 backdrop-blur" />
      <div
        className="absolute bottom-[15%] right-[13%] h-[15%] w-[27%] rounded-xl shadow-[0_12px_30px_-18px_rgba(0,0,0,0.95)]"
        style={{ background: `${video.accent}cc` }}
      />
      <div className="absolute left-5 top-[45%] flex h-10 w-10 items-center justify-center rounded-full bg-white/82 text-[#111315] opacity-0 shadow-[0_10px_34px_-18px_rgba(255,255,255,0.9)] transition-opacity group-hover:opacity-100">
        <IconPlayerPlay size={16} fill="currentColor" stroke={1.5} />
      </div>
      <div className="absolute inset-0 opacity-55 mix-blend-overlay [background-image:linear-gradient(120deg,transparent_18%,rgba(255,255,255,0.32)_48%,transparent_68%)]" />
    </div>
  );
}

function CardStat({
  icon,
  label,
  locale,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  locale: Locale;
  value: string | number;
}) {
  return (
    <div className="rounded-xl bg-black/18 px-2.5 py-2 ring-1 ring-white/[0.045]">
      <div className="flex items-center gap-1.5 text-[10.5px] text-white/36">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-[12px] font-bold text-white/82">
        {typeof value === 'number'
          ? value.toLocaleString(locale === 'zh' ? 'zh-CN' : 'en-US')
          : value}
      </div>
    </div>
  );
}

function isLikelyLink(value: string) {
  return /^(https?:\/\/|www\.|[a-z0-9-]+\.[a-z]{2,})/i.test(value);
}

function createVideoReference(video: HotVideoView): ReferenceItem {
  return {
    id: video.id,
    label: video.product,
    value: video.sourceUrl ?? video.title,
    source: 'video',
  };
}

function FilterPill({
  filter,
  value,
  onChange,
}: {
  filter: FilterConfig;
  value: string;
  onChange: (value: string) => void;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const reallyActive = value !== DEFAULT_FILTERS[filter.key];
  const activeOption = filter.options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;
    const handleClick = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handleClick);
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('mousedown', handleClick);
      window.removeEventListener('keydown', handleKey);
    };
  }, [open]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((c) => !c)}
        className={cn(
          'flex min-h-11 items-center gap-1.5 rounded-full pl-3.5 pr-3 text-[13px] transition-colors',
          reallyActive
            ? 'bg-[#1a1c1f] text-white ring-1 ring-[#ff5fbf]/65'
            : 'bg-[#1a1c1f] text-white/82 ring-1 ring-white/[0.07] hover:bg-[#23262a] hover:ring-white/[0.12]',
        )}
      >
        <span className="font-medium text-white/52">{t(filter.labelKey)}</span>
        <span className={cn('font-bold', reallyActive ? 'text-[#ff5fbf]' : 'text-white')}>
          {activeOption ? t(activeOption.labelKey) : value}
        </span>
        <IconChevronDown
          size={14}
          className={cn(
            'transition-transform',
            open ? '-rotate-180' : 'rotate-0',
            reallyActive ? 'text-[#ff5fbf]' : 'text-white/52',
          )}
          stroke={2.4}
        />
      </button>

      {open ? (
        <div className="absolute left-0 top-[calc(100%+6px)] z-30 min-w-[180px] overflow-hidden rounded-2xl bg-[#1f2226] py-1.5 shadow-[0_22px_60px_-26px_rgba(0,0,0,0.85)] ring-1 ring-white/[0.07]">
          {filter.options.map((option) => {
            const selected = option.value === value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => {
                  onChange(option.value);
                  setOpen(false);
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-3 px-3.5 py-2 text-left text-[13px] transition-colors',
                  selected
                    ? 'bg-white/[0.05] font-bold text-white'
                    : 'text-white/72 hover:bg-white/[0.045] hover:text-white',
                )}
              >
                <span className="flex items-center gap-2">
                  {selected ? (
                    <IconCheck size={14} className="text-[#ff5fbf]" stroke={2.6} />
                  ) : (
                    <span className="inline-block w-[14px]" />
                  )}
                  {t(option.labelKey)}
                </span>
                <IconChevronRight size={13} className="text-white/24" stroke={2.2} />
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
