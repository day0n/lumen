'use client';

import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { Topbar } from '@/components/home/Topbar';
import { cn } from '@/lib/cn';
import type {
  TiktokAbTest,
  TiktokCampaign,
  TiktokDailyPoint,
  TiktokDashboardChannel,
  TiktokDashboardObjective,
  TiktokDashboardPayload,
  TiktokDashboardRange,
  TiktokDashboardRegion,
  TiktokFactorRow,
  TiktokFunnelStage,
  TiktokGeoBreakdown,
  TiktokRecommendation,
  TiktokTraceEvent,
} from '@/lib/tiktok-dashboard-mock';
import {
  IconAdjustments,
  IconArrowDownRight,
  IconArrowUpRight,
  IconBolt,
  IconCalendarStats,
  IconChartBar,
  IconChartDots3,
  IconChartPie,
  IconCheck,
  IconCopy,
  IconDownload,
  IconEye,
  IconFilter,
  IconGauge,
  IconPlayerPause,
  IconPlayerPlay,
  IconRefresh,
  IconSearch,
  IconSettings,
  IconShoppingBag,
  IconSparkles,
  IconTargetArrow,
  IconTrendingUp,
  IconWorld,
} from '@tabler/icons-react';
import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

type DashboardStatus = 'idle' | 'loading' | 'ready' | 'error';
type CampaignSortKey = 'revenue' | 'roas' | 'cvr' | 'spend' | 'creativeScore';
type SortDirection = 'asc' | 'desc';

type DashboardApiResponse =
  | { ok: true; data: TiktokDashboardPayload }
  | { ok: false; error: { message: string } };

interface CampaignEdit {
  status?: TiktokCampaign['status'];
  budgetDelta?: number;
}

interface SortState {
  key: CampaignSortKey;
  direction: SortDirection;
}

const RANGE_OPTIONS: { label: string; value: TiktokDashboardRange }[] = [
  { label: '7D', value: '7d' },
  { label: '14D', value: '14d' },
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
];

const REGION_OPTIONS: { label: string; value: TiktokDashboardRegion }[] = [
  { label: '全球', value: 'global' },
  { label: '美国', value: 'us' },
  { label: '东南亚', value: 'sea' },
  { label: '英国', value: 'uk' },
  { label: '德国', value: 'de' },
];

const CHANNEL_OPTIONS: { label: string; value: TiktokDashboardChannel }[] = [
  { label: '全部渠道', value: 'all' },
  { label: 'Spark Ads', value: 'spark_ads' },
  { label: '达人白名单', value: 'creator_whitelist' },
  { label: '重定向', value: 'retargeting' },
  { label: 'Live Boost', value: 'live_boost' },
];

const OBJECTIVE_OPTIONS: { label: string; value: TiktokDashboardObjective }[] = [
  { label: '成交增长', value: 'sales' },
  { label: 'ROAS 优先', value: 'roas' },
  { label: '冷启动', value: 'cold_start' },
  { label: '创意测试', value: 'creative_test' },
];

const SORT_LABELS: Record<CampaignSortKey, string> = {
  revenue: '收入',
  roas: 'ROAS',
  cvr: 'CVR',
  spend: '花费',
  creativeScore: '创意分',
};

export function DashboardPage() {
  const [range, setRange] = useState<TiktokDashboardRange>('30d');
  const [region, setRegion] = useState<TiktokDashboardRegion>('global');
  const [channel, setChannel] = useState<TiktokDashboardChannel>('all');
  const [objective, setObjective] = useState<TiktokDashboardObjective>('sales');
  const [status, setStatus] = useState<DashboardStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<TiktokDashboardPayload | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCampaignId, setSelectedCampaignId] = useState<string | null>(null);
  const [selectedFactorKey, setSelectedFactorKey] = useState<string | null>(null);
  const [sort, setSort] = useState<SortState>({ key: 'revenue', direction: 'desc' });
  const [campaignEdits, setCampaignEdits] = useState<Record<string, CampaignEdit>>({});
  const [showForecast, setShowForecast] = useState(true);
  const [activityMessage, setActivityMessage] = useState('自动归因窗口已连接：7d click / 1d view');
  const [refreshNonce, setRefreshNonce] = useState(0);

  useEffect(() => {
    const controller = new AbortController();

    async function loadDashboard() {
      setStatus('loading');
      setError(null);

      try {
        const params = new URLSearchParams({
          range,
          region,
          channel,
          objective,
        });
        params.set('nonce', String(refreshNonce));
        const response = await fetch(`/api/tiktok-dashboard?${params.toString()}`, {
          signal: controller.signal,
        });
        const payload = (await response.json()) as DashboardApiResponse;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.ok ? '数据加载失败' : payload.error.message);
        }
        setData(payload.data);
        setSelectedCampaignId((current) => current ?? payload.data.campaigns[0]?.id ?? null);
        setStatus('ready');
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : '数据加载失败');
        setStatus('error');
      }
    }

    void loadDashboard();
    return () => controller.abort();
  }, [range, region, channel, objective, refreshNonce]);

  const campaigns = useMemo(() => {
    if (!data) return [];
    const query = searchQuery.trim().toLowerCase();
    const withEdits = data.campaigns.map((campaign) =>
      applyCampaignEdit(campaign, campaignEdits[campaign.id]),
    );
    const filtered = query
      ? withEdits.filter((campaign) =>
          [
            campaign.name,
            campaign.product,
            campaign.angle,
            campaign.persona,
            campaign.regionLabel,
            campaign.channelLabel,
            ...campaign.factors,
          ]
            .join(' ')
            .toLowerCase()
            .includes(query),
        )
      : withEdits;

    return filtered.sort((a, b) => {
      const aValue = readSortValue(a, sort.key);
      const bValue = readSortValue(b, sort.key);
      return sort.direction === 'desc' ? bValue - aValue : aValue - bValue;
    });
  }, [data, searchQuery, campaignEdits, sort]);

  useEffect(() => {
    if (!campaigns.length) {
      setSelectedCampaignId(null);
      return;
    }
    if (!selectedCampaignId || !campaigns.some((campaign) => campaign.id === selectedCampaignId)) {
      setSelectedCampaignId(campaigns[0]?.id ?? null);
    }
  }, [campaigns, selectedCampaignId]);

  const selectedCampaign =
    campaigns.find((campaign) => campaign.id === selectedCampaignId) ?? campaigns[0] ?? null;

  const selectedFactor =
    data?.factorMatrix.find((factor) => factor.key === selectedFactorKey) ?? null;
  const selectedCampaignTests =
    data?.abTests.filter((test) => test.campaignId === selectedCampaign?.id) ?? [];

  const handleSort = (key: CampaignSortKey) => {
    setSort((current) => ({
      key,
      direction: current.key === key && current.direction === 'desc' ? 'asc' : 'desc',
    }));
  };

  const handleToggleCampaign = (campaign: TiktokCampaign) => {
    setCampaignEdits((current) => ({
      ...current,
      [campaign.id]: {
        ...current[campaign.id],
        status: campaign.status === 'paused' ? 'active' : 'paused',
      },
    }));
    setActivityMessage(
      campaign.status === 'paused'
        ? `${campaign.name} 已模拟恢复投放`
        : `${campaign.name} 已模拟暂停投放`,
    );
  };

  const handleBoostCampaign = (campaign: TiktokCampaign) => {
    setCampaignEdits((current) => ({
      ...current,
      [campaign.id]: {
        ...current[campaign.id],
        budgetDelta: (current[campaign.id]?.budgetDelta ?? 0) + 120,
      },
    }));
    setActivityMessage(`${campaign.name} 已追加 $120 日预算，等待下一轮 mock 归因刷新`);
  };

  const handleOptimizeBudget = () => {
    if (!campaigns.length) return;
    const sorted = [...campaigns].sort((a, b) => b.metrics.roas - a.metrics.roas);
    const winner = sorted[0];
    const laggard = sorted[sorted.length - 1];
    if (!winner || !laggard || winner.id === laggard.id) return;

    setCampaignEdits((current) => ({
      ...current,
      [winner.id]: {
        ...current[winner.id],
        budgetDelta: (current[winner.id]?.budgetDelta ?? 0) + 260,
      },
      [laggard.id]: {
        ...current[laggard.id],
        budgetDelta: (current[laggard.id]?.budgetDelta ?? 0) - 160,
      },
    }));
    setSelectedCampaignId(winner.id);
    setActivityMessage(
      `预算已从 ${laggard.product} 转移到 ${winner.product}，预计 ROAS 抬升 0.3-0.5`,
    );
  };

  const handleExport = () => {
    if (!data) return;
    const blob = new Blob(
      [
        JSON.stringify(
          {
            exportedAt: new Date().toISOString(),
            filters: { range, region, channel, objective },
            campaignEdits,
            data,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json' },
    );
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.download = `lumen-tiktok-dashboard-${range}.json`;
    anchor.click();
    URL.revokeObjectURL(href);
    setActivityMessage('已导出 mock 投放诊断 JSON');
  };

  const handleCopyTracking = async () => {
    if (!selectedCampaign) return;
    const url = `https://lumenstudio.tech/tiktok/track?campaign=${selectedCampaign.id}&factor=${selectedCampaign.factors[0]}`;
    try {
      await navigator.clipboard.writeText(url);
      setActivityMessage('追踪链接已复制到剪贴板');
    } catch {
      setActivityMessage(url);
    }
  };

  const isLoading = status === 'loading' && !data;

  return (
    <div className="relative min-h-screen text-white">
      <AuroraBackdrop />
      <Topbar />

      <main className="relative z-10 mx-auto max-w-[1440px] px-4 pb-28 pt-24 sm:px-6 lg:pt-28">
        <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-[760px]">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-[12px] font-semibold text-white/72 ring-1 ring-white/[0.08]">
                <IconChartDots3 size={15} stroke={2.2} />
                Mock Attribution
              </span>
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#10252b] px-3 text-[12px] font-semibold text-[#79e4ff] ring-1 ring-[#79e4ff]/20">
                <IconCheck size={15} stroke={2.4} />
                TikTok Shop
              </span>
            </div>
            <h1 className="text-[24px] font-bold tracking-tight text-white sm:text-[30px]">
              TikTok 投放追踪数据看板
            </h1>
            <p className="mt-2 max-w-[720px] text-[13px] leading-6 text-white/45">
              用 mock 数据把生成因子、素材表现、A/B 创意、预算调整和成交转化串成一张增长驾驶舱。
            </p>
          </div>

          <div className="flex flex-col gap-2 rounded-xl bg-[#151719]/82 p-2.5 ring-1 ring-white/[0.08] lg:flex-row lg:items-center">
            <SegmentedControl
              options={RANGE_OPTIONS}
              value={range}
              onChange={setRange}
              ariaLabel="投放时间范围"
            />
            <SelectControl
              icon={IconWorld}
              value={region}
              options={REGION_OPTIONS}
              onChange={(value) => setRegion(value as TiktokDashboardRegion)}
              ariaLabel="地区"
            />
            <SelectControl
              icon={IconFilter}
              value={channel}
              options={CHANNEL_OPTIONS}
              onChange={(value) => setChannel(value as TiktokDashboardChannel)}
              ariaLabel="渠道"
            />
            <button
              type="button"
              onClick={() => setRefreshNonce((current) => current + 1)}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-white/[0.06] px-3 text-[12px] font-semibold text-white/78 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.1]"
            >
              <IconRefresh
                size={15}
                stroke={2.2}
                className={status === 'loading' ? 'animate-spin' : ''}
              />
              刷新
            </button>
            <button
              type="button"
              onClick={handleExport}
              disabled={!data}
              className="inline-flex h-9 items-center justify-center gap-2 rounded-lg bg-white px-3 text-[12px] font-bold text-[#111315] transition-opacity hover:opacity-90 disabled:opacity-40"
            >
              <IconDownload size={15} stroke={2.4} />
              导出
            </button>
          </div>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-2 lg:grid-cols-[1fr_auto] lg:items-center">
          <SegmentedControl
            options={OBJECTIVE_OPTIONS}
            value={objective}
            onChange={setObjective}
            ariaLabel="投放目标"
            spacious
          />

          <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl bg-[#151719]/78 px-3 py-2 text-[12px] text-white/46 ring-1 ring-white/[0.08]">
            <IconBolt size={15} className="text-[#f5c76a]" stroke={2.2} />
            <span className="min-w-0 flex-1 truncate">{activityMessage}</span>
            <button
              type="button"
              onClick={() => setShowForecast((current) => !current)}
              className={cn(
                'inline-flex h-7 items-center gap-1.5 rounded-lg px-2 font-semibold transition-colors',
                showForecast
                  ? 'bg-[#79e4ff]/14 text-[#79e4ff] ring-1 ring-[#79e4ff]/20'
                  : 'bg-white/[0.05] text-white/48 ring-1 ring-white/[0.06]',
              )}
            >
              <IconGauge size={14} stroke={2.2} />
              Forecast
            </button>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl bg-[#2a171a]/72 px-4 py-3 text-[13px] text-[#ffabb6] ring-1 ring-[#ff5d73]/16">
            {error}
          </div>
        ) : null}

        {isLoading ? <DashboardSkeleton /> : null}

        {data ? (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard
                icon={IconShoppingBag}
                label="归因收入"
                value={formatCurrency(data.summary.revenue)}
                delta={data.summary.revenueDelta}
                meta={
                  showForecast ? `预测 ${formatCurrency(data.summary.forecastRevenue)}` : '当前窗口'
                }
                accent="#79e4ff"
                sparkline={data.timeseries.map((point) => point.revenue)}
              />
              <MetricCard
                icon={IconTrendingUp}
                label="ROAS"
                value={`${data.summary.roas.toFixed(2)}x`}
                delta={data.summary.roasDelta}
                meta={`${formatCurrency(data.summary.spend)} 花费`}
                accent="#f5c76a"
                sparkline={data.timeseries.map((point) => point.roas)}
              />
              <MetricCard
                icon={IconTargetArrow}
                label="CVR"
                value={`${data.summary.cvr.toFixed(2)}%`}
                delta={data.summary.cvrDelta}
                meta={`${formatNumber(data.summary.orders)} 单成交`}
                accent="#8dd9a3"
                sparkline={data.timeseries.map((point) => point.cvr)}
              />
              <MetricCard
                icon={IconEye}
                label="3 秒停留"
                value={`${data.summary.thumbStop.toFixed(1)}%`}
                delta={4.8}
                meta={`${data.summary.watchAvg.toFixed(1)}s 平均观看`}
                accent="#9da8ff"
                sparkline={data.timeseries.map((point) => point.ctr)}
              />
              <MetricCard
                icon={IconGauge}
                label="归因置信度"
                value={`${data.summary.confidence}%`}
                delta={2.6}
                meta="生成因子 × 成交事件"
                accent="#ffb86b"
                sparkline={data.factorMatrix.map((factor) => factor.confidence)}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,0.8fr)]">
              <div className="space-y-4">
                <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
                  <SectionHeader
                    icon={IconChartBar}
                    title="投放趋势"
                    meta={`${formatDate(data.generatedAt)} 刷新`}
                    action={
                      <span className="text-[12px] text-white/40">
                        收入/花费双轴 ·{' '}
                        {RANGE_OPTIONS.find((option) => option.value === range)?.label}
                      </span>
                    }
                  />
                  <PerformanceChart points={data.timeseries} />
                </section>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                  <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
                    <SectionHeader icon={IconChartPie} title="转化漏斗" meta="从曝光到成交" />
                    <FunnelChart stages={data.funnel} />
                  </section>

                  <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
                    <SectionHeader icon={IconWorld} title="区域贡献" meta="GMV share" />
                    <GeoBreakdownChart items={data.geoBreakdown} />
                  </section>
                </div>

                <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
                  <SectionHeader
                    icon={IconSparkles}
                    title="生成因子 × 转化效果"
                    meta={selectedFactor ? selectedFactor.factor : '点击因子查看诊断'}
                  />
                  <FactorMatrix
                    factors={data.factorMatrix}
                    selectedKey={selectedFactorKey}
                    onSelect={(factor) =>
                      setSelectedFactorKey((current) =>
                        current === factor.key ? null : factor.key,
                      )
                    }
                  />
                  {selectedFactor ? (
                    <div className="mt-3 rounded-lg bg-white/[0.035] px-3 py-2 text-[12px] leading-5 text-white/52 ring-1 ring-white/[0.05]">
                      <span className="font-semibold text-white/78">{selectedFactor.factor}</span>
                      <span className="mx-2 text-white/22">/</span>
                      {selectedFactor.diagnosis}
                    </div>
                  ) : null}
                </section>

                <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
                  <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                    <SectionHeader
                      icon={IconAdjustments}
                      title="Campaign 控制台"
                      meta="支持排序、搜索、预算模拟"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <label className="flex h-10 min-w-0 items-center gap-2 rounded-lg bg-white/[0.05] px-3 text-white/42 ring-1 ring-white/[0.08] sm:w-[260px]">
                        <IconSearch size={15} stroke={2.2} />
                        <input
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                          className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/32"
                          placeholder="搜索商品、因子、地区"
                        />
                      </label>
                      <button
                        type="button"
                        onClick={handleOptimizeBudget}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#79e4ff] px-3 text-[12px] font-bold text-[#071316] transition-opacity hover:opacity-90"
                      >
                        <IconBolt size={15} stroke={2.5} />
                        智能调预算
                      </button>
                    </div>
                  </div>
                  <CampaignTable
                    campaigns={campaigns}
                    sort={sort}
                    selectedCampaignId={selectedCampaign?.id ?? null}
                    onSort={handleSort}
                    onSelect={(campaign) => setSelectedCampaignId(campaign.id)}
                    onToggle={handleToggleCampaign}
                    onBoost={handleBoostCampaign}
                  />
                </section>
              </div>

              <aside className="space-y-4">
                <CampaignInspector
                  campaign={selectedCampaign}
                  tests={selectedCampaignTests}
                  onCopyTracking={handleCopyTracking}
                  onToggle={
                    selectedCampaign ? () => handleToggleCampaign(selectedCampaign) : undefined
                  }
                  onBoost={
                    selectedCampaign ? () => handleBoostCampaign(selectedCampaign) : undefined
                  }
                />
                <RecommendationPanel items={data.recommendations} onApply={handleOptimizeBudget} />
                <TracePanel events={data.trace} />
              </aside>
            </div>
          </>
        ) : null}
      </main>
    </div>
  );
}

function applyCampaignEdit(campaign: TiktokCampaign, edit?: CampaignEdit): TiktokCampaign {
  if (!edit) return campaign;
  return {
    ...campaign,
    status: edit.status ?? campaign.status,
    budget: Math.max(80, campaign.budget + (edit.budgetDelta ?? 0)),
  };
}

function readSortValue(campaign: TiktokCampaign, key: CampaignSortKey) {
  if (key === 'creativeScore') return campaign.creativeScore;
  return campaign.metrics[key];
}

function SectionHeader({
  icon: Icon,
  title,
  meta,
  action,
}: {
  icon: typeof IconChartBar;
  title: string;
  meta?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-center gap-3">
      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/[0.06] text-white/66 ring-1 ring-white/[0.06]">
        <Icon size={16} stroke={2.2} />
      </span>
      <div className="min-w-0">
        <h2 className="text-[15px] font-bold text-white">{title}</h2>
        {meta ? <p className="mt-0.5 truncate text-[11px] text-white/34">{meta}</p> : null}
      </div>
      {action ? <div className="ml-auto">{action}</div> : null}
    </div>
  );
}

function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  spacious = false,
}: {
  options: { label: string; value: T }[];
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  spacious?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        'grid rounded-lg bg-white/[0.045] p-1 ring-1 ring-white/[0.06]',
        spacious ? 'grid-cols-2 gap-1 md:grid-cols-4' : 'grid-cols-4',
      )}
    >
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-8 rounded-md px-3 text-[12px] font-semibold transition-colors',
              active
                ? 'bg-white text-[#111315]'
                : 'text-white/48 hover:bg-white/[0.05] hover:text-white/80',
            )}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function SelectControl({
  icon: Icon,
  value,
  options,
  onChange,
  ariaLabel,
}: {
  icon: typeof IconWorld;
  value: string;
  options: { label: string; value: string }[];
  onChange: (value: string) => void;
  ariaLabel: string;
}) {
  return (
    <label className="relative flex h-9 min-w-[132px] items-center gap-2 rounded-lg bg-white/[0.045] px-3 text-white/58 ring-1 ring-white/[0.06]">
      <Icon size={15} stroke={2.2} />
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-0 flex-1 appearance-none bg-transparent pr-5 text-[12px] font-semibold text-white outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value} className="bg-[#111315] text-white">
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  delta,
  meta,
  accent,
  sparkline,
}: {
  icon: typeof IconShoppingBag;
  label: string;
  value: string;
  delta: number;
  meta: string;
  accent: string;
  sparkline: number[];
}) {
  const positive = delta >= 0;
  return (
    <section className="min-h-[132px] rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
      <div className="mb-3 flex items-start justify-between gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/[0.06] ring-1 ring-white/[0.06]">
          <Icon size={18} stroke={2.2} style={{ color: accent }} />
        </span>
        <span
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-bold',
            positive
              ? 'bg-[#123326] text-[#8dd9a3] ring-1 ring-[#8dd9a3]/20'
              : 'bg-[#35191e] text-[#ff93a4] ring-1 ring-[#ff93a4]/18',
          )}
        >
          {positive ? <IconArrowUpRight size={13} /> : <IconArrowDownRight size={13} />}
          {Math.abs(delta).toFixed(1)}%
        </span>
      </div>
      <div className="text-[12px] font-semibold text-white/42">{label}</div>
      <div className="mt-1 flex items-end gap-3">
        <div className="min-w-0 flex-1 text-[25px] font-bold leading-none tracking-tight text-white">
          {value}
        </div>
        <MiniSparkline values={sparkline} color={accent} />
      </div>
      <div className="mt-3 truncate text-[11px] text-white/34">{meta}</div>
    </section>
  );
}

function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  const points = buildPolylinePoints(values, 96, 30);
  return (
    <svg className="h-[30px] w-[96px] shrink-0 overflow-visible" viewBox="0 0 96 30" role="img">
      <title>趋势</title>
      <polyline points={points} fill="none" stroke={color} strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

function PerformanceChart({ points }: { points: TiktokDailyPoint[] }) {
  const width = 760;
  const height = 260;
  const padding = { top: 18, right: 18, bottom: 34, left: 48 };
  const maxRevenue = Math.max(...points.map((point) => point.revenue), 1);
  const maxSpend = Math.max(...points.map((point) => point.spend), 1);
  const getX = (index: number) =>
    padding.left +
    (index / Math.max(points.length - 1, 1)) * (width - padding.left - padding.right);
  const getRevenueY = (value: number) =>
    padding.top + (1 - value / maxRevenue) * (height - padding.top - padding.bottom);
  const getSpendHeight = (value: number) =>
    (value / maxSpend) * (height - padding.top - padding.bottom) * 0.56;
  const revenuePath = points
    .map(
      (point, index) => `${index === 0 ? 'M' : 'L'} ${getX(index)} ${getRevenueY(point.revenue)}`,
    )
    .join(' ');
  const areaPath = `${revenuePath} L ${getX(points.length - 1)} ${height - padding.bottom} L ${getX(0)} ${
    height - padding.bottom
  } Z`;

  return (
    <div className="h-[300px] overflow-hidden rounded-lg bg-[#101214] ring-1 ring-white/[0.05]">
      <svg className="h-full w-full" viewBox={`0 0 ${width} ${height}`} role="img">
        <title>TikTok 投放趋势</title>
        <defs>
          <linearGradient id="trend-area" x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="#79e4ff" stopOpacity="0.26" />
            <stop offset="100%" stopColor="#79e4ff" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, 1, 2, 3].map((tick) => {
          const y = padding.top + tick * ((height - padding.top - padding.bottom) / 3);
          return (
            <line
              key={tick}
              x1={padding.left}
              x2={width - padding.right}
              y1={y}
              y2={y}
              stroke="rgba(255,255,255,0.06)"
            />
          );
        })}
        {points.map((point, index) => {
          const barWidth = Math.max(3, (width - padding.left - padding.right) / points.length - 5);
          const barHeight = getSpendHeight(point.spend);
          return (
            <rect
              key={point.date}
              x={getX(index) - barWidth / 2}
              y={height - padding.bottom - barHeight}
              width={barWidth}
              height={barHeight}
              rx="3"
              fill="rgba(245,199,106,0.38)"
            />
          );
        })}
        <path d={areaPath} fill="url(#trend-area)" />
        <path d={revenuePath} fill="none" stroke="#79e4ff" strokeWidth="3" strokeLinecap="round" />
        {points.map((point, index) => {
          if (index % Math.ceil(points.length / 6) !== 0 && index !== points.length - 1)
            return null;
          return (
            <g key={point.date}>
              <text
                x={getX(index)}
                y={height - 12}
                textAnchor="middle"
                fill="rgba(255,255,255,0.38)"
                fontSize="11"
              >
                {point.label}
              </text>
            </g>
          );
        })}
        <text x={padding.left} y={14} fill="rgba(255,255,255,0.45)" fontSize="11">
          Revenue
        </text>
        <text x={width - 88} y={14} fill="rgba(245,199,106,0.75)" fontSize="11">
          Spend bars
        </text>
      </svg>
    </div>
  );
}

function FunnelChart({ stages }: { stages: TiktokFunnelStage[] }) {
  const max = stages[0]?.value ?? 1;
  return (
    <div className="space-y-2">
      {stages.map((stage, index) => {
        const width = Math.max(8, (stage.value / max) * 100);
        const strong = stage.rate >= stage.benchmark || index === 0;
        return (
          <div key={stage.key} className="rounded-lg bg-white/[0.035] p-3 ring-1 ring-white/[0.04]">
            <div className="mb-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white/78">
                {stage.label}
              </span>
              <span className="text-[11px] text-white/36">{formatCompact(stage.value)}</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={cn('h-full rounded-full', strong ? 'bg-[#79e4ff]' : 'bg-[#ffb86b]')}
                style={{ width: `${width}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className={strong ? 'text-[#8dd9a3]' : 'text-[#ffb86b]'}>{stage.rate}%</span>
              <span className="text-white/28">基准 {stage.benchmark}%</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GeoBreakdownChart({ items }: { items: TiktokGeoBreakdown[] }) {
  const maxRevenue = Math.max(...items.map((item) => item.revenue), 1);
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.region}>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-white/78">{item.region}</span>
            <span className="text-[11px] text-white/38">
              {formatCurrency(item.revenue)} · {item.roas.toFixed(2)}x
            </span>
          </div>
          <div className="h-9 overflow-hidden rounded-lg bg-white/[0.035] ring-1 ring-white/[0.04]">
            <div
              className="flex h-full items-center justify-end rounded-lg bg-gradient-to-r from-[#19414b] via-[#79e4ff] to-[#f5c76a] px-2 text-[11px] font-bold text-[#071316]"
              style={{ width: `${Math.max(12, (item.revenue / maxRevenue) * 100)}%` }}
            >
              {item.share}%
            </div>
          </div>
        </div>
      ))}
      {items.length === 0 ? <EmptyState text="暂无区域数据" /> : null}
    </div>
  );
}

function FactorMatrix({
  factors,
  selectedKey,
  onSelect,
}: {
  factors: TiktokFactorRow[];
  selectedKey: string | null;
  onSelect: (factor: TiktokFactorRow) => void;
}) {
  const columns = [
    { key: 'ctrLift', label: 'CTR' },
    { key: 'cvrLift', label: 'CVR' },
    { key: 'roasLift', label: 'ROAS' },
    { key: 'retentionLift', label: '留存' },
  ] as const;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-separate border-spacing-y-2">
        <thead>
          <tr className="text-left text-[11px] uppercase text-white/32">
            <th className="px-3 py-1 font-semibold">因子</th>
            <th className="px-3 py-1 font-semibold">模块</th>
            <th className="px-3 py-1 font-semibold">信号</th>
            {columns.map((column) => (
              <th key={column.key} className="px-3 py-1 text-center font-semibold">
                {column.label}
              </th>
            ))}
            <th className="px-3 py-1 text-right font-semibold">置信度</th>
          </tr>
        </thead>
        <tbody>
          {factors.map((factor) => {
            const selected = selectedKey === factor.key;
            return (
              <tr
                key={factor.key}
                className={cn(
                  'rounded-lg text-[12px] transition-colors',
                  selected
                    ? 'bg-[#14313a] ring-1 ring-[#79e4ff]/24'
                    : 'bg-white/[0.035] hover:bg-white/[0.06]',
                )}
              >
                <td className="rounded-l-lg px-3 py-3">
                  <button
                    type="button"
                    onClick={() => onSelect(factor)}
                    className="w-full text-left"
                    aria-pressed={selected}
                  >
                    <span className="block font-bold text-white/88">{factor.factor}</span>
                    <span className="mt-1 block text-[11px] text-white/32">
                      Score {factor.score}
                    </span>
                  </button>
                </td>
                <td className="px-3 py-3">
                  <span className="rounded-full bg-white/[0.06] px-2 py-1 text-[11px] font-semibold text-white/52">
                    {factor.module}
                  </span>
                </td>
                <td className="px-3 py-3 text-white/50">{factor.signal}</td>
                {columns.map((column) => (
                  <td key={column.key} className="px-3 py-3">
                    <HeatCell value={factor[column.key]} />
                  </td>
                ))}
                <td className="rounded-r-lg px-3 py-3 text-right font-bold text-white/72">
                  {factor.confidence}%
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function HeatCell({ value }: { value: number }) {
  const intensity = Math.min(1, Math.abs(value) / 20);
  const background =
    value >= 0
      ? `rgba(121, 228, 255, ${0.12 + intensity * 0.36})`
      : `rgba(255, 125, 148, ${0.12 + intensity * 0.34})`;
  const color = value >= 0 ? '#d5f8ff' : '#ffd7de';
  return (
    <div
      className="mx-auto flex h-8 w-[76px] items-center justify-center rounded-md text-[12px] font-bold ring-1 ring-white/[0.04]"
      style={{ background, color }}
    >
      {value > 0 ? '+' : ''}
      {value.toFixed(1)}%
    </div>
  );
}

function CampaignTable({
  campaigns,
  sort,
  selectedCampaignId,
  onSort,
  onSelect,
  onToggle,
  onBoost,
}: {
  campaigns: TiktokCampaign[];
  sort: SortState;
  selectedCampaignId: string | null;
  onSort: (key: CampaignSortKey) => void;
  onSelect: (campaign: TiktokCampaign) => void;
  onToggle: (campaign: TiktokCampaign) => void;
  onBoost: (campaign: TiktokCampaign) => void;
}) {
  const headers: CampaignSortKey[] = ['revenue', 'roas', 'cvr', 'spend', 'creativeScore'];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-separate border-spacing-y-2">
        <thead>
          <tr className="text-left text-[11px] uppercase text-white/32">
            <th className="px-3 py-1 font-semibold">Campaign</th>
            <th className="px-3 py-1 font-semibold">状态</th>
            <th className="px-3 py-1 font-semibold">预算</th>
            {headers.map((key) => (
              <th key={key} className="px-3 py-1 text-right font-semibold">
                <button
                  type="button"
                  onClick={() => onSort(key)}
                  className="inline-flex items-center gap-1 transition-colors hover:text-white/72"
                >
                  {SORT_LABELS[key]}
                  {sort.key === key ? (
                    sort.direction === 'desc' ? (
                      <IconArrowDownRight size={12} />
                    ) : (
                      <IconArrowUpRight size={12} />
                    )
                  ) : null}
                </button>
              </th>
            ))}
            <th className="px-3 py-1 text-right font-semibold">操作</th>
          </tr>
        </thead>
        <tbody>
          {campaigns.map((campaign) => {
            const selected = selectedCampaignId === campaign.id;
            return (
              <tr
                key={campaign.id}
                className={cn(
                  'text-[12px] transition-colors',
                  selected
                    ? 'bg-[#14313a] ring-1 ring-[#79e4ff]/24'
                    : 'bg-white/[0.035] hover:bg-white/[0.06]',
                )}
              >
                <td className="rounded-l-lg px-3 py-3">
                  <button
                    type="button"
                    onClick={() => onSelect(campaign)}
                    className="flex w-full items-center gap-3 text-left"
                    aria-pressed={selected}
                  >
                    <span
                      className="h-11 w-11 shrink-0 rounded-lg ring-1 ring-white/[0.08]"
                      style={{ background: campaign.thumbnail }}
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[13px] font-bold text-white/88">
                        {campaign.name}
                      </span>
                      <span className="mt-1 block truncate text-[11px] text-white/34">
                        {campaign.product} · {campaign.regionLabel} · {campaign.channelLabel}
                      </span>
                    </span>
                  </button>
                </td>
                <td className="px-3 py-3">
                  <StatusBadge status={campaign.status} />
                </td>
                <td className="px-3 py-3 font-semibold text-white/68">
                  {formatCurrency(campaign.budget)}/d
                </td>
                <td className="px-3 py-3 text-right font-bold text-white/82">
                  {formatCurrency(campaign.metrics.revenue)}
                </td>
                <td className="px-3 py-3 text-right text-[#79e4ff]">
                  {campaign.metrics.roas.toFixed(2)}x
                </td>
                <td className="px-3 py-3 text-right text-white/68">
                  {campaign.metrics.cvr.toFixed(2)}%
                </td>
                <td className="px-3 py-3 text-right text-white/50">
                  {formatCurrency(campaign.metrics.spend)}
                </td>
                <td className="px-3 py-3 text-right font-semibold text-white/72">
                  {campaign.creativeScore}
                </td>
                <td className="rounded-r-lg px-3 py-3">
                  <div className="flex justify-end gap-2">
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onBoost(campaign);
                      }}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-white/[0.06] px-2 text-[11px] font-semibold text-white/68 transition-colors hover:bg-white/[0.1]"
                    >
                      <IconBolt size={13} />
                      Boost
                    </button>
                    <button
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        onToggle(campaign);
                      }}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-white/[0.06] px-2 text-[11px] font-semibold text-white/68 transition-colors hover:bg-white/[0.1]"
                    >
                      {campaign.status === 'paused' ? (
                        <IconPlayerPlay size={13} />
                      ) : (
                        <IconPlayerPause size={13} />
                      )}
                      {campaign.status === 'paused' ? '启用' : '暂停'}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {campaigns.length === 0 ? <EmptyState text="没有匹配的 campaign" /> : null}
    </div>
  );
}

function CampaignInspector({
  campaign,
  tests,
  onCopyTracking,
  onToggle,
  onBoost,
}: {
  campaign: TiktokCampaign | null;
  tests: TiktokAbTest[];
  onCopyTracking: () => void;
  onToggle?: () => void;
  onBoost?: () => void;
}) {
  if (!campaign) {
    return (
      <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
        <EmptyState text="请选择一个 campaign" />
      </section>
    );
  }

  return (
    <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
      <SectionHeader icon={IconSettings} title="创意诊断" meta={campaign.product} />
      <div className="grid grid-cols-[128px_minmax(0,1fr)] gap-4">
        <div className="relative aspect-[9/16] overflow-hidden rounded-xl bg-[#0d0f11] ring-1 ring-white/[0.08]">
          <div className="absolute inset-0" style={{ background: campaign.thumbnail }} />
          <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,.08),rgba(0,0,0,.78))]" />
          <div className="absolute left-3 right-3 top-3 flex items-center justify-between">
            <span className="rounded-full bg-black/34 px-2 py-1 text-[10px] font-bold text-white/86">
              9:16
            </span>
            <span className="rounded-full bg-[#79e4ff] px-2 py-1 text-[10px] font-bold text-[#071316]">
              {campaign.creativeScore}
            </span>
          </div>
          <div className="absolute bottom-3 left-3 right-3">
            <div className="line-clamp-2 text-[13px] font-black leading-4 text-white">
              {campaign.angle}
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/20">
              <div
                className="h-full rounded-full bg-white"
                style={{ width: `${campaign.metrics.holdRate}%` }}
              />
            </div>
            <div className="mt-1 text-[10px] text-white/58">Hold {campaign.metrics.holdRate}%</div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={campaign.status} />
            <span className="rounded-full bg-white/[0.05] px-2 py-1 text-[11px] font-semibold text-white/44">
              {campaign.stage}
            </span>
          </div>
          <h3 className="mt-3 text-[16px] font-bold leading-5 text-white">{campaign.name}</h3>
          <p className="mt-2 text-[12px] leading-5 text-white/46">{campaign.hook}</p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniMetric label="ROAS" value={`${campaign.metrics.roas.toFixed(2)}x`} />
            <MiniMetric label="CPA" value={formatCurrency(campaign.metrics.cpa)} />
            <MiniMetric label="疲劳度" value={`${campaign.fatigue}%`} />
            <MiniMetric label="日预算" value={formatCurrency(campaign.budget)} />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {campaign.factors.map((factor) => (
              <span
                key={factor}
                className="rounded-full bg-[#79e4ff]/10 px-2 py-1 text-[11px] font-semibold text-[#bff4ff] ring-1 ring-[#79e4ff]/18"
              >
                {factor}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-white/[0.035] p-3 ring-1 ring-white/[0.04]">
        <div className="text-[11px] font-bold uppercase text-white/30">素材来源声明</div>
        <p className="mt-1 text-[12px] leading-5 text-white/50">{campaign.materialSource}</p>
        <p className="mt-1 text-[11px] leading-5 text-white/34">{campaign.sourceDeclaration}</p>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <button
          type="button"
          onClick={onCopyTracking}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-white/[0.06] text-[11px] font-bold text-white/70 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.1]"
        >
          <IconCopy size={14} />
          复制追踪
        </button>
        <button
          type="button"
          onClick={onBoost}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#79e4ff] text-[11px] font-bold text-[#071316] transition-opacity hover:opacity-90"
        >
          <IconBolt size={14} />
          加预算
        </button>
        <button
          type="button"
          onClick={onToggle}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-white/[0.06] text-[11px] font-bold text-white/70 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.1]"
        >
          {campaign.status === 'paused' ? (
            <IconPlayerPlay size={14} />
          ) : (
            <IconPlayerPause size={14} />
          )}
          {campaign.status === 'paused' ? '启用' : '暂停'}
        </button>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-[12px] font-bold text-white/72">A/B 创意对比</div>
        <div className="space-y-2">
          {tests.map((test) => (
            <div key={test.id} className="rounded-lg bg-white/[0.035] p-3 ring-1 ring-white/[0.04]">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    'flex h-6 w-6 items-center justify-center rounded-md text-[11px] font-black',
                    test.winner ? 'bg-[#8dd9a3] text-[#071316]' : 'bg-white/[0.08] text-white/58',
                  )}
                >
                  {test.variant}
                </span>
                <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-white/74">
                  {test.hook}
                </span>
                <span className={test.winner ? 'text-[#8dd9a3]' : 'text-white/42'}>
                  {test.lift > 0 ? '+' : ''}
                  {test.lift}%
                </span>
              </div>
              <div className="mt-2 grid grid-cols-3 gap-2 text-[11px] text-white/42">
                <span>{test.roas.toFixed(2)}x ROAS</span>
                <span>{test.cvr.toFixed(2)}% CVR</span>
                <span>{test.thumbStop.toFixed(1)}% 3s</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/[0.035] p-2.5 ring-1 ring-white/[0.04]">
      <div className="text-[10px] text-white/32">{label}</div>
      <div className="mt-1 truncate text-[13px] font-bold text-white/82">{value}</div>
    </div>
  );
}

function RecommendationPanel({
  items,
  onApply,
}: {
  items: TiktokRecommendation[];
  onApply: () => void;
}) {
  return (
    <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
      <SectionHeader
        icon={IconTargetArrow}
        title="增长建议"
        meta="Agent 自动归因"
        action={
          <button
            type="button"
            onClick={onApply}
            className="rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-bold text-white/68 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.1]"
          >
            一键应用
          </button>
        }
      />
      <div className="space-y-2">
        {items.map((item) => (
          <div key={item.id} className="rounded-lg bg-white/[0.035] p-3 ring-1 ring-white/[0.04]">
            <div className="flex items-start gap-2">
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#f5c76a]/14 text-[#f5c76a]">
                <IconSparkles size={14} stroke={2.2} />
              </span>
              <div className="min-w-0 flex-1">
                <div className="text-[12px] font-bold leading-5 text-white/84">{item.title}</div>
                <div className="mt-1 text-[11px] leading-5 text-white/42">{item.detail}</div>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="rounded-full bg-[#123326] px-2 py-1 font-bold text-[#8dd9a3]">
                {item.impact}
              </span>
              <span className="rounded-full bg-white/[0.05] px-2 py-1 text-white/45">
                {item.confidence}% confidence
              </span>
              <span className="rounded-full bg-white/[0.05] px-2 py-1 text-white/45">
                {item.owner}
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function TracePanel({ events }: { events: TiktokTraceEvent[] }) {
  return (
    <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
      <SectionHeader icon={IconCalendarStats} title="生成过程 Trace" meta="素材—剧本—创作—投放" />
      <div className="space-y-3">
        {events.map((event, index) => (
          <div key={event.id} className="relative flex gap-3">
            {index < events.length - 1 ? (
              <span className="absolute left-[13px] top-7 h-[calc(100%+2px)] w-px bg-white/[0.08]" />
            ) : null}
            <span
              className={cn(
                'relative z-10 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ring-1',
                event.status === 'done'
                  ? 'bg-[#123326] text-[#8dd9a3] ring-[#8dd9a3]/22'
                  : event.status === 'running'
                    ? 'bg-[#10252b] text-[#79e4ff] ring-[#79e4ff]/22'
                    : 'bg-[#322211] text-[#f5c76a] ring-[#f5c76a]/22',
              )}
            >
              {event.status === 'done' ? <IconCheck size={14} /> : <IconBolt size={14} />}
            </span>
            <div className="min-w-0 flex-1 pb-1">
              <div className="flex items-center gap-2">
                <span className="text-[12px] font-bold text-white/82">{event.stage}</span>
                <span className="text-[10px] text-white/28">{event.latencyMs}ms</span>
              </div>
              <div className="mt-1 text-[11px] text-white/34">{event.agent}</div>
              <div className="mt-1 text-[11px] leading-5 text-white/48">{event.output}</div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: TiktokCampaign['status'] }) {
  const label = status === 'active' ? '投放中' : status === 'learning' ? '学习中' : '已暂停';
  return (
    <span
      className={cn(
        'inline-flex h-7 items-center rounded-full px-2.5 text-[11px] font-bold',
        status === 'active'
          ? 'bg-[#123326] text-[#8dd9a3] ring-1 ring-[#8dd9a3]/18'
          : status === 'learning'
            ? 'bg-[#10252b] text-[#79e4ff] ring-1 ring-[#79e4ff]/18'
            : 'bg-white/[0.05] text-white/38 ring-1 ring-white/[0.06]',
      )}
    >
      {label}
    </span>
  );
}

function DashboardSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-5">
      {Array.from({ length: 5 }, (_, index) => `metric-skeleton-${index}`).map((key) => (
        <div
          key={key}
          className="h-[132px] animate-pulse rounded-xl bg-white/[0.045] ring-1 ring-white/[0.04]"
        />
      ))}
    </div>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="flex min-h-[96px] items-center justify-center rounded-lg bg-white/[0.025] text-[12px] text-white/35 ring-1 ring-white/[0.04]">
      {text}
    </div>
  );
}

function buildPolylinePoints(values: number[], width: number, height: number) {
  const max = Math.max(...values, 1);
  const min = Math.min(...values, max);
  const range = Math.max(max - min, 1);
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function formatCurrency(value: number) {
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 10_000) return `$${(value / 1_000).toFixed(1)}k`;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('en-US').format(value);
}

function formatCompact(value: number) {
  return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

function formatDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';
  return `${date.getMonth() + 1}/${date.getDate()} ${String(date.getHours()).padStart(2, '0')}:${String(
    date.getMinutes(),
  ).padStart(2, '0')}`;
}
