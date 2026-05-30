'use client';

import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { Topbar } from '@/components/home/Topbar';
import { useLoginRedirect } from '@/lib/auth-redirect';
import type { HotVideoRecord, MaterialAssetRecord, ProjectRecord } from '@lumen/db';
import {
  IconArrowUpRight,
  IconChartBar,
  IconClock,
  IconDeviceTv,
  IconFolder,
  IconPhoto,
  IconSparkles,
  IconVideo,
  IconWaveSine,
} from '@tabler/icons-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

type DashboardStatus = 'idle' | 'loading' | 'ready' | 'error';

type ProjectsPayload =
  | { ok: true; data: { projects: ProjectRecord[] } }
  | { ok: false; error: { message: string } };

type AssetsPayload =
  | { ok: true; data: { assets: MaterialAssetRecord[] } }
  | { ok: false; error: { message: string } };

type HotVideosPayload =
  | { ok: true; data: { items: HotVideoRecord[]; total: number } }
  | { ok: false; error: { message: string } };

interface DashboardData {
  projects: ProjectRecord[];
  assets: MaterialAssetRecord[];
  hotVideos: HotVideoRecord[];
}

export function DashboardPage() {
  const { isLoaded: authLoaded, isSignedIn, requireLogin } = useLoginRedirect();
  const [status, setStatus] = useState<DashboardStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<DashboardData>({
    projects: [],
    assets: [],
    hotVideos: [],
  });

  useEffect(() => {
    if (!authLoaded) return;
    if (!isSignedIn) {
      requireLogin('/dashboard');
      return;
    }

    const controller = new AbortController();

    async function loadDashboard() {
      setStatus('loading');
      setError(null);

      try {
        const [projects, assets, hotVideos] = await Promise.all([
          fetchJson<ProjectsPayload>('/api/projects?limit=40', controller.signal).then(
            (payload) => payload.data.projects,
          ),
          fetchJson<AssetsPayload>('/api/material-assets?limit=80', controller.signal).then(
            (payload) => payload.data.assets,
          ),
          fetchJson<HotVideosPayload>(
            '/api/hot-videos?owner=me&limit=20',
            controller.signal,
          ).then((payload) => payload.data.items),
        ]);

        setData({ projects, assets, hotVideos });
        setStatus('ready');
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setStatus('error');
        setError(loadError instanceof Error ? loadError.message : '数据读取失败');
      }
    }

    void loadDashboard();
    return () => controller.abort();
  }, [authLoaded, isSignedIn, requireLogin]);

  const summary = useMemo(() => buildSummary(data), [data]);
  const recentProjects = data.projects.slice(0, 5);
  const recentAssets = data.assets.slice(0, 6);
  const hotVideos = data.hotVideos.slice(0, 5);

  return (
    <div className="relative min-h-screen text-white">
      <AuroraBackdrop />
      <Topbar />

      <main className="relative z-10 mx-auto max-w-[1180px] px-6 pb-24 pt-28">
        <div className="mb-5 flex flex-wrap items-end gap-3">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-white">数据看板</h1>
            <p className="mt-1 text-[12px] text-white/35">创作资产和爆款参考概览</p>
          </div>

          <Link
            href="/canvas/new"
            className="ml-auto inline-flex h-10 items-center gap-2 rounded-xl bg-white px-3.5 text-[13px] font-semibold text-[#111315] transition-opacity hover:opacity-90"
          >
            <IconSparkles size={16} stroke={2.3} />
            新建项目
          </Link>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl bg-[#2a171a]/72 px-4 py-3 text-[13px] text-[#ffabb6] ring-1 ring-[#ff5d73]/16">
            {error}
          </div>
        ) : null}

        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summary.map((item) => {
            const Icon = item.icon;
            return (
              <section
                key={item.label}
                className="min-h-[112px] rounded-xl bg-[#171819]/86 p-4 ring-1 ring-white/[0.08]"
              >
                <div className="mb-4 flex items-center justify-between gap-3">
                  <span className="text-[12px] font-medium text-white/45">{item.label}</span>
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] text-white/70">
                    <Icon size={17} stroke={2.2} />
                  </span>
                </div>
                <div className="text-[24px] font-bold leading-none text-white">{item.value}</div>
                <div className="mt-2 text-[11px] text-white/35">{item.meta}</div>
              </section>
            );
          })}
        </div>

        <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-[1.15fr_0.85fr]">
          <section className="rounded-xl bg-[#171819]/86 p-4 ring-1 ring-white/[0.08]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-bold text-white">近期项目</h2>
              <Link
                href="/canvas/projects"
                className="inline-flex items-center gap-1 text-[12px] text-white/45 transition-colors hover:text-white"
              >
                全部
                <IconArrowUpRight size={14} stroke={2.2} />
              </Link>
            </div>

            <div className="space-y-2">
              {status === 'loading' ? <LoadingRows count={4} /> : null}
              {status !== 'loading' && recentProjects.length === 0 ? (
                <EmptyState text="暂无项目" />
              ) : null}
              {recentProjects.map((project) => (
                <Link
                  key={project.id}
                  href={`/canvas/${project.id}`}
                  className="flex min-h-[58px] items-center gap-3 rounded-lg bg-white/[0.035] px-3 ring-1 ring-white/[0.04] transition-colors hover:bg-white/[0.06]"
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-white/[0.07] text-white/62">
                    <IconFolder size={17} stroke={2.2} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-semibold text-white/88">
                      {project.title}
                    </span>
                    <span className="mt-1 flex items-center gap-1 text-[11px] text-white/35">
                      <IconClock size={12} stroke={2.1} />
                      {formatRelativeTime(project.updatedAt)}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>

          <section className="rounded-xl bg-[#171819]/86 p-4 ring-1 ring-white/[0.08]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="text-[15px] font-bold text-white">素材分布</h2>
              <span className="text-[12px] text-white/35">{data.assets.length} 个素材</span>
            </div>

            <div className="grid grid-cols-3 gap-2">
              <AssetMetric
                icon={IconPhoto}
                label="图片"
                value={data.assets.filter((asset) => asset.kind === 'image').length}
              />
              <AssetMetric
                icon={IconVideo}
                label="视频"
                value={data.assets.filter((asset) => asset.kind === 'video').length}
              />
              <AssetMetric
                icon={IconWaveSine}
                label="音频"
                value={data.assets.filter((asset) => asset.kind === 'audio').length}
              />
            </div>

            <div className="mt-3 space-y-2">
              {status === 'loading' ? <LoadingRows count={3} /> : null}
              {status !== 'loading' && recentAssets.length === 0 ? (
                <EmptyState text="暂无素材" />
              ) : null}
              {recentAssets.map((asset) => (
                <div
                  key={asset.id}
                  className="flex min-h-[48px] items-center gap-3 rounded-lg bg-white/[0.035] px-3 ring-1 ring-white/[0.04]"
                >
                  <span className="h-2 w-2 rounded-full bg-[#8bd3ff]" />
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-white/78">
                    {asset.title}
                  </span>
                  <span className="text-[11px] text-white/34">{formatAssetKind(asset.kind)}</span>
                </div>
              ))}
            </div>
          </section>
        </div>

        <section className="mt-4 rounded-xl bg-[#171819]/86 p-4 ring-1 ring-white/[0.08]">
          <div className="mb-3 flex items-center justify-between gap-3">
            <h2 className="text-[15px] font-bold text-white">我的爆款参考</h2>
            <Link
              href="/hot-videos"
              className="inline-flex items-center gap-1 text-[12px] text-white/45 transition-colors hover:text-white"
            >
              查看
              <IconArrowUpRight size={14} stroke={2.2} />
            </Link>
          </div>

          <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-5">
            {status === 'loading' ? <LoadingTiles count={5} /> : null}
            {status !== 'loading' && hotVideos.length === 0 ? <EmptyState text="暂无参考" /> : null}
            {hotVideos.map((video) => (
              <Link
                key={video.id}
                href="/hot-videos"
                className="min-h-[112px] rounded-lg bg-white/[0.035] p-3 ring-1 ring-white/[0.04] transition-colors hover:bg-white/[0.06]"
              >
                <div className="mb-3 flex items-center justify-between gap-2">
                  <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] text-white/62">
                    <IconDeviceTv size={16} stroke={2.1} />
                  </span>
                  <span className="text-[11px] font-semibold text-[#8bd3ff]">
                    {video.analysis.score}
                  </span>
                </div>
                <div className="line-clamp-2 text-[12px] font-semibold leading-5 text-white/86">
                  {video.title}
                </div>
                <div className="mt-2 truncate text-[11px] text-white/35">
                  {video.metrics.revenueLabel}
                </div>
              </Link>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

async function fetchJson<T extends { ok: boolean; error?: { message: string } }>(
  url: string,
  signal: AbortSignal,
): Promise<Extract<T, { ok: true }>> {
  const response = await fetch(url, { signal });
  const payload = (await response.json()) as T;

  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? '数据读取失败' : (payload.error?.message ?? '数据读取失败'));
  }

  return payload as Extract<T, { ok: true }>;
}

function buildSummary(data: DashboardData) {
  const updatedThisWeek = data.projects.filter((project) => {
    const updatedAt = new Date(project.updatedAt);
    if (Number.isNaN(updatedAt.getTime())) return false;
    return Date.now() - updatedAt.getTime() < 7 * 24 * 60 * 60 * 1000;
  }).length;

  return [
    {
      label: '项目',
      value: String(data.projects.length),
      meta: `${updatedThisWeek} 个近 7 天更新`,
      icon: IconFolder,
    },
    {
      label: '素材',
      value: String(data.assets.length),
      meta: `${data.assets.filter((asset) => asset.source === 'workflow_result').length} 个来自工作流`,
      icon: IconPhoto,
    },
    {
      label: '爆款参考',
      value: String(data.hotVideos.length),
      meta: '已下载样本',
      icon: IconDeviceTv,
    },
    {
      label: '平均评分',
      value: averageScore(data.hotVideos),
      meta: '我的参考视频',
      icon: IconChartBar,
    },
  ];
}

function averageScore(videos: HotVideoRecord[]) {
  if (videos.length === 0) return '—';
  const total = videos.reduce((sum, video) => sum + video.analysis.score, 0);
  return String(Math.round(total / videos.length));
}

function AssetMetric({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof IconPhoto;
  label: string;
  value: number;
}) {
  return (
    <div className="min-h-[78px] rounded-lg bg-white/[0.035] p-3 ring-1 ring-white/[0.04]">
      <Icon size={16} className="text-white/48" stroke={2.2} />
      <div className="mt-3 text-[18px] font-bold leading-none text-white">{value}</div>
      <div className="mt-1 text-[11px] text-white/34">{label}</div>
    </div>
  );
}

function LoadingRows({ count }: { count: number }) {
  return Array.from({ length: count }).map((_, index) => (
    <div
      key={index}
      className="h-[54px] animate-pulse rounded-lg bg-white/[0.045] ring-1 ring-white/[0.03]"
    />
  ));
}

function LoadingTiles({ count }: { count: number }) {
  return Array.from({ length: count }).map((_, index) => (
    <div
      key={index}
      className="min-h-[112px] animate-pulse rounded-lg bg-white/[0.045] ring-1 ring-white/[0.03]"
    />
  ));
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-[88px] items-center justify-center rounded-lg bg-white/[0.025] text-[12px] text-white/35 ring-1 ring-white/[0.04]">
      {text}
    </div>
  );
}

function formatRelativeTime(value: string) {
  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) return '刚刚';

  const diffMs = Math.max(0, Date.now() - updatedAt.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes} 分钟前`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;

  const days = Math.floor(hours / 24);
  return `${days} 天前`;
}

function formatAssetKind(kind: MaterialAssetRecord['kind']) {
  if (kind === 'image') return '图片';
  if (kind === 'video') return '视频';
  return '音频';
}
