'use client';

import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { Topbar } from '@/components/home/Topbar';
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
  IconLink,
  IconLoader2,
  IconLock,
  IconPhotoPlus,
  IconPlayerPlay,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconShoppingBag,
  IconSparkles,
  IconTrendingUp,
  IconUpload,
  IconVolume,
  IconVolumeOff,
  IconX,
} from '@tabler/icons-react';
import { motion } from 'motion/react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
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
}

interface ListHotVideosApiResponse {
  ok: boolean;
  data?: { items: HotVideoRecord[]; total: number };
  error?: { message: string };
}

type Filters = Record<FilterKey, string>;

const FILTERS: { key: FilterKey; label: string; options: string[] }[] = [
  { key: 'owner', label: '已下载', options: ['全部', '仅我的'] },
  { key: 'region', label: '地区', options: ['全部', '美国', '越南', '菲律宾', '泰国', '西班牙'] },
  {
    key: 'category',
    label: '品类',
    options: ['全部', '美妆个护', '居家日用', '女装与女士内衣', '食品饮料', '电脑办公'],
  },
  { key: 'gmv', label: 'GMV', options: ['全部', '$1k+', '$5k+', '$10k+'] },
  { key: 'videoType', label: '视频类型', options: ['全部', '用户原创', '达人口播', '测评种草'] },
  { key: 'published', label: '发布日期', options: ['近 7 天', '近 30 天', '全部'] },
];

const DEFAULT_FILTERS: Filters = {
  owner: '全部',
  region: '全部',
  category: '全部',
  gmv: '全部',
  videoType: '全部',
  published: '全部',
};

const PUBLISHED_RANGE: Record<string, '7d' | '30d' | 'all'> = {
  '近 7 天': '7d',
  '近 30 天': '30d',
  全部: 'all',
};

const GMV_MIN: Record<string, number | undefined> = {
  全部: undefined,
  '$1k+': 1000,
  '$5k+': 5000,
  '$10k+': 10000,
};

function buildQueryString(filters: Filters, query: string): string {
  const params = new URLSearchParams();
  if (filters.owner === '仅我的') params.set('owner', 'me');
  if (filters.region !== '全部') params.set('region', filters.region);
  if (filters.category !== '全部') params.set('category', filters.category);
  if (filters.videoType !== '全部') params.set('videoType', filters.videoType);
  const publishedRange = PUBLISHED_RANGE[filters.published];
  if (publishedRange && publishedRange !== 'all') params.set('published', publishedRange);
  const gmvMin = GMV_MIN[filters.gmv];
  if (gmvMin !== undefined) params.set('gmvMin', String(gmvMin));
  const trimmed = query.trim();
  if (trimmed) params.set('q', trimmed);
  params.set('limit', '60');
  return params.toString();
}

function toView(record: HotVideoRecord): HotVideoView {
  const date = new Date(record.publishedAt);
  const valid = !Number.isNaN(date.getTime());
  const daysAgo = valid
    ? Math.max(0, Math.floor((Date.now() - date.getTime()) / (24 * 60 * 60 * 1000)))
    : 0;
  const publishedAtLabel = valid
    ? `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}`
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

  // Debounce the local search input → appliedQuery (server param)
  useEffect(() => {
    const id = window.setTimeout(() => setAppliedQuery(searchQuery), 280);
    return () => window.clearTimeout(id);
  }, [searchQuery]);

  useEffect(() => {
    if (filters.owner === '仅我的' && !isSignedIn) {
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
        const response = await fetch(`/api/hot-videos?${qs}`, { signal: controller.signal });
        const payload = (await response.json()) as ListHotVideosApiResponse;
        if (!response.ok || !payload.ok || !payload.data) {
          throw new Error(payload.error?.message ?? '加载失败');
        }
        setVideos(payload.data.items.map(toView));
      } catch (error) {
        if (controller.signal.aborted) return;
        setLoadError(error instanceof Error ? error.message : '加载失败');
        setVideos([]);
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void load();
    return () => controller.abort();
  }, [filters, appliedQuery, isSignedIn]);

  const totalSales = videos.reduce((sum, v) => sum + v.sales, 0);
  const avgViewsLabel = useMemo(() => {
    if (!videos.length) return '—';
    const wan = videos
      .map((v) => Number.parseFloat(v.viewsLabel.replace('万', '')))
      .filter((n) => Number.isFinite(n));
    if (!wan.length) return '—';
    const avg = wan.reduce((s, n) => s + n, 0) / wan.length;
    return `${Math.round(avg)}万`;
  }, [videos]);

  const replicaVideo =
    replicaTarget?.source === 'video'
      ? videos.find((v) => v.id === replicaTarget.id)
      : (replicaPreview ?? undefined);

  const handleFilterChange = (key: FilterKey, value: string) => {
    if (key === 'owner' && value === '仅我的' && !requireLogin('/hot-videos')) {
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
      setInputError('粘贴 TikTok 视频链接');
      return;
    }
    if (!isLikelyLink(value)) {
      setInputError('请粘贴一个有效的视频链接');
      return;
    }

    setInputError(null);
    setParseLoading(true);

    try {
      const response = await fetch('/api/hot-videos/parse-link', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: value }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        data?: HotVideoRecord;
        error?: { message?: string };
      };

      if (!response.ok || !payload.ok || !payload.data) {
        setInputError(payload.error?.message ?? '解析失败，请重试');
        return;
      }

      const view = toView(payload.data);
      setVideos((current) => [view, ...current.filter((v) => v.id !== view.id)]);
      setReplicaPreview(view);
      setReplicaTarget(createVideoReference(view));
      setConfigOpen(true);
      setReferenceInput('');
    } catch (error) {
      setInputError(error instanceof Error ? error.message : '解析失败，请重试');
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
      setInputError('浏览器暂未允许读取剪贴板');
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

  return (
    <div className="relative min-h-screen text-white">
      <AuroraBackdrop />
      <Topbar />

      <main className="relative z-10 mx-auto max-w-[1260px] px-6 pb-20 pt-28">
        <motion.section
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease: [0.32, 0.72, 0, 1] }}
          className="relative overflow-hidden rounded-[22px] bg-[#17191c]/82 p-5 shadow-[0_30px_90px_-52px_rgba(0,0,0,0.9)] ring-1 ring-white/[0.08] md:p-7"
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_14%_12%,rgba(121,228,255,0.12),transparent_34%),radial-gradient(circle_at_88%_10%,rgba(245,199,106,0.12),transparent_28%)]" />

          <div className="relative text-center">
            <div className="mx-auto inline-flex items-center gap-2 rounded-full bg-white/[0.055] px-3 py-1.5 text-[12px] font-semibold text-white/68 ring-1 ring-white/[0.07]">
              <IconFlame size={14} stroke={2.4} />
              爆款参考
            </div>
            <h1 className="font-display mx-auto mt-5 max-w-[820px] text-[34px] font-extrabold leading-tight tracking-tight text-white md:text-[46px]">
              从爆款视频里拆出下一条带货脚本
            </h1>
            <p className="mx-auto mt-3 max-w-[760px] text-[14px] leading-7 text-white/52">
              粘贴 TikTok 视频链接，AI 会拉取视频元数据并拆出脚本结构。
            </p>

            <form
              onSubmit={handleSubmit}
              className="mx-auto mt-7 max-w-[980px] overflow-hidden rounded-[18px] bg-[#111315]/86 text-left ring-1 ring-white/[0.09]"
            >
              <div className="flex min-h-[58px] items-center gap-3 px-4">
                <IconLink size={18} className="shrink-0 text-white/42" stroke={2.2} />
                <input
                  value={referenceInput}
                  onChange={(event) => {
                    setReferenceInput(event.target.value);
                    if (inputError) setInputError(null);
                  }}
                  disabled={parseLoading}
                  placeholder="粘贴 TikTok 视频链接（https://www.tiktok.com/...）"
                  className="min-w-0 flex-1 bg-transparent text-[14px] text-white outline-none placeholder:text-white/30 disabled:opacity-60"
                />
                <button
                  type="button"
                  onClick={pasteFromClipboard}
                  disabled={parseLoading}
                  className="hidden h-10 items-center gap-1.5 rounded-xl bg-white/[0.055] px-3 text-[12px] font-semibold text-white/58 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.09] hover:text-white disabled:opacity-60 sm:flex"
                >
                  <IconCopyPlus size={15} stroke={2.2} />
                  粘贴
                </button>
                <button
                  type="submit"
                  disabled={parseLoading}
                  className="flex h-10 items-center gap-1.5 rounded-xl bg-white px-4 text-[13px] font-bold text-[#111315] shadow-[0_14px_34px_-22px_rgba(255,255,255,0.9)] transition-transform active:scale-[0.97] disabled:cursor-wait disabled:opacity-70"
                >
                  {parseLoading ? (
                    <>
                      <IconLoader2 size={15} className="animate-spin" stroke={2.4} />
                      正在拆解…
                    </>
                  ) : (
                    <>
                      拆解参考
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
              onClick={resetFilters}
              className="ml-auto flex h-9 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-[#ff5fbf] transition-colors hover:bg-[#ff5fbf]/10"
            >
              <IconRefresh size={13} stroke={2.4} />
              重置筛选
            </button>
          </div>
        </section>

        <section className="mt-5">
          <div className="mb-4 flex flex-wrap items-end gap-3">
            <div>
              <h2 className="text-[18px] font-bold text-white">热门参考</h2>
              <div className="mt-1 text-[12px] text-white/35">
                {loading
                  ? '正在加载…'
                  : `${videos.length} 条结果 · ${totalSales.toLocaleString('zh-CN')} 销量 · 平均 ${avgViewsLabel}浏览`}
              </div>
            </div>
            <label className="ml-auto flex h-10 min-w-[260px] items-center gap-2 rounded-xl bg-[#141619] px-3 ring-1 ring-white/[0.08]">
              <IconSearch size={16} className="text-white/38" stroke={2.1} />
              <input
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="搜索标题、商品、标签"
                className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/30"
              />
            </label>
          </div>

          {loadError ? (
            <div className="rounded-[18px] bg-[#1c1e20] p-6 text-[13px] text-[#f5c76a] ring-1 ring-white/[0.07]">
              加载失败：{loadError}
            </div>
          ) : loading && videos.length === 0 ? (
            <div className="flex h-40 items-center justify-center rounded-[18px] bg-[#1c1e20] text-white/52 ring-1 ring-white/[0.07]">
              <IconLoader2 size={20} className="mr-2 animate-spin" stroke={2.2} />
              加载中
            </div>
          ) : videos.length === 0 ? (
            <div className="rounded-[18px] bg-[#1c1e20] p-10 text-center text-[13px] text-white/48 ring-1 ring-white/[0.07]">
              {filters.owner === '仅我的'
                ? '你还没有下载过视频，粘贴 TikTok 链接即可加入个人库'
                : '当前筛选条件下没有结果'}
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
        <ReplicaConfigModal
          target={replicaTarget}
          video={replicaVideo}
          onClose={() => setConfigOpen(false)}
        />
      ) : null}

      {previewVideo ? (
        <VideoPreviewModal video={previewVideo} onClose={() => setPreviewVideo(null)} />
      ) : null}
    </div>
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
  const [hovered, setHovered] = useState(false);
  const [muted, setMuted] = useState(true);

  const stop = (event: React.MouseEvent) => {
    event.stopPropagation();
  };

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.42, delay: index * 0.035, ease: [0.32, 0.72, 0, 1] }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      className="group overflow-hidden rounded-[18px] bg-[#1c1e20] ring-1 ring-white/[0.07] transition-colors hover:bg-[#222528]"
    >
      <button
        type="button"
        onClick={onPreview}
        aria-label="打开视频预览"
        className="relative block aspect-[3/4] w-full overflow-hidden text-left focus:outline-none"
      >
        <VideoStill video={video} hovered={hovered} muted={muted} />
        <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
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
        <div className="absolute right-3 top-3 flex items-center gap-2">
          {video.previewUrl ? (
            <button
              type="button"
              onClick={(event) => {
                stop(event);
                setMuted((current) => !current);
              }}
              aria-label={muted ? '取消静音' : '静音'}
              className="flex h-8 w-8 items-center justify-center rounded-full bg-black/52 text-white/82 backdrop-blur transition-colors hover:bg-black/72 hover:text-white"
            >
              {muted ? (
                <IconVolumeOff size={16} stroke={2.2} />
              ) : (
                <IconVolume size={16} stroke={2.2} />
              )}
            </button>
          ) : null}
          <span
            className={cn(
              'flex h-8 items-center gap-1 rounded-full px-2.5 text-[11px] font-semibold backdrop-blur',
              ownedByMe
                ? 'bg-[#79e4ff]/22 text-[#79e4ff] ring-1 ring-[#79e4ff]/32'
                : 'bg-black/36 text-white/74',
            )}
            title={ownedByMe ? '我已下载' : '其他用户下载'}
          >
            <IconHeart size={14} fill={ownedByMe ? 'currentColor' : 'none'} stroke={2.2} />
            {ownedByMe ? '已下载' : null}
          </span>
        </div>
        <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.82))] px-3 pb-3 pt-16">
          <div className="line-clamp-2 text-[13px] font-bold leading-5 text-white">
            {video.title}
          </div>
          <div className="mt-1 flex items-center gap-1.5 text-[11px] text-white/52">
            <IconCalendar size={12} stroke={2.1} />
            {video.publishedAt}
          </div>
        </div>
      </button>

      <div className="space-y-3 p-3.5">
        <div className="grid grid-cols-2 gap-2">
          <CardStat
            icon={<IconShoppingBag size={13} stroke={2.2} />}
            label="销量"
            value={video.sales}
          />
          <CardStat
            icon={<IconTrendingUp size={13} stroke={2.2} />}
            label="销售额"
            value={video.revenueLabel}
          />
          <CardStat
            icon={<IconEye size={13} stroke={2.2} />}
            label="浏览量"
            value={video.viewsLabel}
          />
          <CardStat icon={<IconFlame size={13} stroke={2.2} />} label="ROAS" value={video.roas} />
        </div>

        <button
          type="button"
          disabled={signedIn && !ownedByMe}
          onClick={(event) => {
            stop(event);
            if (!signedIn) {
              onRequireLogin();
              return;
            }
            if (!ownedByMe) return;
            onUse();
          }}
          title={
            !signedIn
              ? '注册后可下载并复刻视频'
              : ownedByMe
                ? '基于该视频生成新内容'
                : '只能复刻自己下载的视频'
          }
          className={cn(
            'flex h-9 w-full items-center justify-center gap-1.5 rounded-xl text-[12px] font-semibold transition-colors',
            ownedByMe
              ? 'bg-white/[0.075] text-white/82 ring-1 ring-white/[0.06] hover:bg-white hover:text-[#111315]'
              : !signedIn
                ? 'bg-white/[0.055] text-white/62 ring-1 ring-white/[0.05] hover:bg-white hover:text-[#111315]'
                : 'cursor-not-allowed bg-white/[0.035] text-white/32 ring-1 ring-white/[0.04]',
          )}
        >
          {ownedByMe ? (
            <>
              <IconCheck size={14} stroke={2.4} />
              爆款复刻
            </>
          ) : !signedIn ? (
            <>
              <IconLock size={13} stroke={2.4} />
              注册后复刻
            </>
          ) : (
            <>
              <IconLock size={13} stroke={2.4} />
              仅自己下载可复刻
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
          aria-label="关闭视频预览"
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
              视频不可用
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
            <span>浏览 {video.viewsLabel}</span>
            {video.sourceUrl ? (
              <a
                href={video.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="ml-auto inline-flex items-center gap-1 text-[#79e4ff] hover:text-white"
              >
                <IconExternalLink size={13} stroke={2.2} />
                打开原始链接
              </a>
            ) : null}
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function ReplicaConfigModal({
  target,
  video,
  onClose,
}: {
  target: ReferenceItem;
  video?: HotVideoView;
  onClose: () => void;
}) {
  const fileInputId = useId();
  const [uploadedImages, setUploadedImages] = useState<UploadedProductImage[]>([]);
  const [prompt, setPrompt] = useState('');
  const canGenerate = uploadedImages.length > 0;

  const handleUpload = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    const availableSlots = 9 - uploadedImages.length;
    const nextImages = files.slice(0, availableSlots).map((file, index) => ({
      id: `${file.name}-${file.size}-${file.lastModified}-${Date.now()}-${index}`,
      name: file.name,
    }));

    if (nextImages.length) {
      setUploadedImages((current) => [...current, ...nextImages]);
    }

    event.currentTarget.value = '';
  };

  const removeImage = (imageId: string) => {
    setUploadedImages((current) => current.filter((image) => image.id !== imageId));
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
          aria-label="关闭复刻配置"
          className="absolute right-5 top-5 z-10 flex h-10 w-10 items-center justify-center rounded-xl bg-white/[0.055] text-white/52 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.1] hover:text-white"
        >
          <IconX size={18} stroke={2.2} />
        </button>

        <div className="grid min-h-0 flex-1 gap-0 overflow-y-auto lg:grid-cols-[320px_minmax(0,1fr)]">
          <section className="border-b border-white/[0.07] p-6 lg:border-b-0 lg:border-r">
            <div className="text-[12px] font-semibold text-white/42">原视频预览</div>
            <div className="mt-4 flex justify-center lg:justify-start">
              <div className="relative aspect-[9/16] w-full max-w-[264px] overflow-hidden rounded-[18px] bg-black ring-1 ring-white/[0.08]">
                {video ? (
                  <VideoStill video={video} hovered />
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
                      {target.source === 'link' ? '外部链接' : video?.region}
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
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[#9da8ff]/16 text-[#9da8ff] ring-1 ring-[#9da8ff]/18">
                <IconSparkles size={19} stroke={2.3} />
              </span>
              <div>
                <h2 className="text-[20px] font-bold text-white">爆款复刻配置</h2>
                <p className="mt-1 text-[13px] text-white/42">
                  设置你的复刻参数，AI 将基于原视频生成全新内容
                </p>
              </div>
            </div>

            <div className="mt-7">
              <div className="flex items-center gap-2 text-[14px] font-bold text-white">
                上传商品图片（必填，最多9张）
                <span className="text-[#f5c76a]">*</span>
              </div>
              <p className="mt-2 text-[12px] leading-5 text-white/38">
                请上传白底商品图，更多角度产品图可以让视频一致性更强。
              </p>

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
                  上传
                </label>

                {uploadedImages.map((image) => (
                  <div
                    key={image.id}
                    className="relative flex h-[88px] w-[88px] flex-col items-center justify-center rounded-xl bg-white/[0.06] px-2 text-center ring-1 ring-white/[0.08]"
                  >
                    <IconPhotoPlus size={22} className="text-white/48" stroke={2.1} />
                    <div className="mt-2 line-clamp-2 text-[10px] leading-4 text-white/58">
                      {image.name}
                    </div>
                    <button
                      type="button"
                      onClick={() => removeImage(image.id)}
                      aria-label={`移除 ${image.name}`}
                      className="absolute -right-2 -top-2 flex h-6 w-6 items-center justify-center rounded-full bg-[#24272a] text-white/55 ring-1 ring-white/[0.12] hover:text-white"
                    >
                      <IconX size={13} stroke={2.2} />
                    </button>
                  </div>
                ))}
              </div>

              <div className="mt-3 text-[12px] text-white/36">已上传 {uploadedImages.length}/9</div>
            </div>

            <div className="mt-6">
              <label htmlFor="replica-prompt" className="text-[14px] font-bold text-white">
                复刻提示词（选填）
              </label>
              <textarea
                id="replica-prompt"
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="请输入产品信息、卖点、价格及原视频修改需求，AI 将基于原爆款结构生成新的带货内容"
                className="mt-3 h-[112px] w-full resize-none rounded-xl bg-white/[0.045] px-4 py-3 text-[13px] leading-6 text-white outline-none ring-1 ring-white/[0.08] placeholder:text-white/28 focus:ring-[#79e4ff]/34"
              />
            </div>

            <div className="mt-6">
              <div className="flex items-center gap-2 text-[14px] font-bold text-white">
                <IconSettings size={16} stroke={2.2} />
                视频设置
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {[
                  ['视频比例', '9:16'],
                  ['时长', '15s'],
                  ['文案语言', '中文'],
                  ['生成模式', '标准复刻'],
                  ['清晰度', '720p'],
                  ['生成数量', '1条'],
                ].map(([label, value]) => (
                  <button
                    key={label}
                    type="button"
                    className="flex h-12 items-center justify-between rounded-xl bg-white/[0.045] px-4 text-left ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.075]"
                  >
                    <span className="text-[12px] text-white/38">{label}</span>
                    <span className="text-[13px] font-bold text-white">{value}</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t border-white/[0.08] px-6 py-4">
          <div className="text-[12px] text-white/38">
            生成时间约 2-5 分钟，可在项目管理中查看进度
          </div>
          <button
            type="button"
            disabled={!canGenerate}
            className={cn(
              'ml-auto flex h-11 items-center justify-center gap-2 rounded-xl px-5 text-[13px] font-bold transition-transform active:scale-[0.98]',
              canGenerate
                ? 'bg-white text-[#111315]'
                : 'bg-white/[0.08] text-white/42 ring-1 ring-white/[0.07]',
            )}
          >
            <IconUpload size={15} stroke={2.3} />
            生成
            <span className="rounded-full bg-black/10 px-2 py-0.5 text-[11px]">75 积分</span>
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
  hovered = false,
  muted = true,
}: {
  video: HotVideoView;
  hovered?: boolean;
  muted?: boolean;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hasVideo = Boolean(video.previewUrl);
  const cover = video.thumbnailUrl;

  useEffect(() => {
    const node = videoRef.current;
    if (!node) return;
    node.muted = muted;
  }, [muted]);

  useEffect(() => {
    const node = videoRef.current;
    if (!node) return;
    if (hovered) {
      node.currentTime = 0;
      void node.play().catch(() => {
        // Autoplay can be blocked when tab is hidden; ignore.
      });
    } else {
      node.pause();
      node.currentTime = 0;
    }
  }, [hovered]);

  if (hasVideo) {
    return (
      <div className="absolute inset-0" style={{ background: video.paletteCss }}>
        {cover ? (
          <img
            src={cover}
            alt={video.title}
            loading="lazy"
            referrerPolicy="no-referrer"
            className={cn(
              'absolute inset-0 h-full w-full object-cover transition-opacity duration-200',
              hovered ? 'opacity-0' : 'opacity-100',
            )}
          />
        ) : null}
        <video
          ref={videoRef}
          src={video.previewUrl}
          poster={cover}
          loop
          playsInline
          preload="metadata"
          className={cn(
            'absolute inset-0 h-full w-full object-cover transition-opacity duration-200',
            hovered ? 'opacity-100' : 'opacity-0',
          )}
        >
          <track kind="captions" />
        </video>
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.05)_0%,transparent_30%,rgba(0,0,0,0.45)_100%)]" />
      </div>
    );
  }

  if (cover) {
    return (
      <div className="absolute inset-0" style={{ background: video.paletteCss }}>
        <img
          src={cover}
          alt={video.title}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="absolute inset-0 h-full w-full object-cover"
        />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.05)_0%,transparent_30%,rgba(0,0,0,0.45)_100%)]" />
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
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
}) {
  return (
    <div className="rounded-xl bg-black/18 px-2.5 py-2 ring-1 ring-white/[0.045]">
      <div className="flex items-center gap-1.5 text-[10.5px] text-white/36">
        {icon}
        {label}
      </div>
      <div className="mt-1 truncate text-[12px] font-bold text-white/82">
        {typeof value === 'number' ? value.toLocaleString('zh-CN') : value}
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
  filter: { key: FilterKey; label: string; options: string[] };
  value: string;
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const reallyActive = value !== DEFAULT_FILTERS[filter.key];

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
          'flex h-9 items-center gap-1.5 rounded-full pl-3.5 pr-3 text-[13px] transition-colors',
          reallyActive
            ? 'bg-[#1a1c1f] text-white ring-1 ring-[#ff5fbf]/65'
            : 'bg-[#1a1c1f] text-white/82 ring-1 ring-white/[0.07] hover:bg-[#23262a] hover:ring-white/[0.12]',
        )}
      >
        <span className="font-medium text-white/52">{filter.label}</span>
        <span className={cn('font-bold', reallyActive ? 'text-[#ff5fbf]' : 'text-white')}>
          {value}
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
            const selected = option === value;
            return (
              <button
                key={option}
                type="button"
                onClick={() => {
                  onChange(option);
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
                  {option}
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
