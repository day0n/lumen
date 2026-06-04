'use client';

import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { Topbar } from '@/components/home/Topbar';
import { MobileSheet } from '@/components/mobile';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { useI18n } from '@/i18n/provider';
import type { Locale } from '@/i18n/routing';
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
import { getTiktokFactorLabel } from '@/lib/tiktok-dashboard-mock';
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
import { useEffect, useId, useMemo, useState } from 'react';

type DashboardStatus = 'idle' | 'loading' | 'ready' | 'error';
type CampaignSortKey = 'revenue' | 'roas' | 'cvr' | 'spend' | 'creativeScore';
type SortDirection = 'asc' | 'desc';
type TFunction = ReturnType<typeof useI18n>['t'];

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

interface ActivityMessage {
  key: string;
  params?: Record<string, string | number>;
}

const RANGE_OPTIONS: { label: string; value: TiktokDashboardRange }[] = [
  { label: '7D', value: '7d' },
  { label: '14D', value: '14d' },
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
];

const REGION_OPTIONS: { labelKey: string; value: TiktokDashboardRegion }[] = [
  { labelKey: 'global', value: 'global' },
  { labelKey: 'us', value: 'us' },
  { labelKey: 'sea', value: 'sea' },
  { labelKey: 'uk', value: 'uk' },
  { labelKey: 'de', value: 'de' },
];

const CHANNEL_OPTIONS: { labelKey: string; label?: string; value: TiktokDashboardChannel }[] = [
  { labelKey: 'allChannels', value: 'all' },
  { labelKey: 'spark_ads', label: 'Spark Ads', value: 'spark_ads' },
  { labelKey: 'creator', value: 'creator_whitelist' },
  { labelKey: 'retargeting', value: 'retargeting' },
  { labelKey: 'live_boost', label: 'Live Boost', value: 'live_boost' },
];

const OBJECTIVE_OPTIONS: { labelKey: string; value: TiktokDashboardObjective }[] = [
  { labelKey: 'sales', value: 'sales' },
  { labelKey: 'roas', value: 'roas' },
  { labelKey: 'cold', value: 'cold_start' },
  { labelKey: 'creative', value: 'creative_test' },
];

const SORT_LABEL_KEYS: Record<CampaignSortKey, string> = {
  revenue: 'revenue',
  roas: 'ROAS',
  cvr: 'CVR',
  spend: 'spend',
  creativeScore: 'creativeScore',
};

export function DashboardPage() {
  const isMobile = useIsMobile();
  const { locale, t } = useI18n();
  const [filtersOpen, setFiltersOpen] = useState(false);
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
  const [activityMessage, setActivityMessage] = useState<ActivityMessage>({
    key: 'dashboard.activity',
  });
  const [refreshNonce, setRefreshNonce] = useState(0);
  const regionOptions = useMemo(
    () =>
      REGION_OPTIONS.map((option) => ({
        label: t(`dashboard.controls.${option.labelKey}`),
        value: option.value,
      })),
    [t],
  );
  const channelOptions = useMemo(
    () =>
      CHANNEL_OPTIONS.map((option) => ({
        label: option.label ?? t(`dashboard.controls.${option.labelKey}`),
        value: option.value,
      })),
    [t],
  );
  const objectiveOptions = useMemo(
    () =>
      OBJECTIVE_OPTIONS.map((option) => ({
        label: t(`dashboard.controls.${option.labelKey}`),
        value: option.value,
      })),
    [t],
  );

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
          headers: {
            'x-lumen-locale': locale,
          },
        });
        const payload = (await response.json()) as DashboardApiResponse;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.ok ? t('dashboard.dataFailed') : payload.error.message);
        }
        setData(payload.data);
        setSelectedCampaignId((current) => current ?? payload.data.campaigns[0]?.id ?? null);
        setStatus('ready');
      } catch (loadError) {
        if (controller.signal.aborted) return;
        setError(loadError instanceof Error ? loadError.message : t('dashboard.dataFailed'));
        setStatus('error');
      }
    }

    void loadDashboard();
    return () => controller.abort();
  }, [range, region, channel, objective, refreshNonce, locale, t]);

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
        ? { key: 'dashboard.restored', params: { name: campaign.name } }
        : { key: 'dashboard.paused', params: { name: campaign.name } },
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
    setActivityMessage({ key: 'dashboard.boosted', params: { name: campaign.name } });
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
    setActivityMessage({
      key: 'dashboard.optimized',
      params: { from: laggard.product, to: winner.product },
    });
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
    setActivityMessage({ key: 'dashboard.exported' });
  };

  const handleCopyTracking = async () => {
    if (!selectedCampaign) return;
    const url = `https://lumenstudio.tech/tiktok/track?campaign=${selectedCampaign.id}&factor=${selectedCampaign.factors[0]}`;
    try {
      await navigator.clipboard.writeText(url);
      setActivityMessage({ key: 'dashboard.copied' });
    } catch {
      setActivityMessage({ key: url });
    }
  };

  const isLoading = status === 'loading' && !data;

  return (
    <div className="relative min-h-screen text-white">
      <AuroraBackdrop />
      <Topbar />

      <main className="relative z-10 mx-auto max-w-[1440px] px-4 pb-nav-mobile pt-24 sm:px-6 lg:pt-28">
        <div className="mb-4 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="max-w-[760px]">
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 text-[12px] font-semibold text-white/72 ring-1 ring-white/[0.08]">
                <IconChartDots3 size={15} stroke={2.2} />
                {t('dashboard.attribution')}
              </span>
              <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#10252b] px-3 text-[12px] font-semibold text-[#79e4ff] ring-1 ring-[#79e4ff]/20">
                <IconCheck size={15} stroke={2.4} />
                TikTok Shop
              </span>
            </div>
            <h1 className="text-[24px] font-bold tracking-tight text-white sm:text-[30px]">
              {t('dashboard.title')}
            </h1>
            <p className="mt-2 max-w-[720px] text-[13px] leading-6 text-white/45">
              {t('dashboard.subtitle')}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            {isMobile ? (
              <button
                type="button"
                onClick={() => setFiltersOpen(true)}
                className="inline-flex min-h-11 items-center justify-center gap-2 rounded-xl bg-[#151719]/82 px-4 text-[13px] font-semibold text-white/78 ring-1 ring-white/[0.08] lg:hidden"
              >
                <IconFilter size={16} stroke={2.2} />
                {t('dashboard.channel')}
              </button>
            ) : null}
            <div className="hidden flex-col gap-2 rounded-xl bg-[#151719]/82 p-2.5 ring-1 ring-white/[0.08] lg:flex lg:flex-row lg:items-center">
              <DashboardFilterControls
                range={range}
                region={region}
                channel={channel}
                regionOptions={regionOptions}
                channelOptions={channelOptions}
                status={status}
                data={data}
                onRangeChange={setRange}
                onRegionChange={setRegion}
                onChannelChange={setChannel}
                onRefresh={() => setRefreshNonce((current) => current + 1)}
                onExport={handleExport}
                t={t}
              />
            </div>
          </div>
          <MobileSheet open={filtersOpen} onClose={() => setFiltersOpen(false)} title={t('dashboard.range')}>
            <DashboardFilterControls
              range={range}
              region={region}
              channel={channel}
              regionOptions={regionOptions}
              channelOptions={channelOptions}
              status={status}
              data={data}
              onRangeChange={setRange}
              onRegionChange={setRegion}
              onChannelChange={setChannel}
              onRefresh={() => {
                setRefreshNonce((current) => current + 1);
                setFiltersOpen(false);
              }}
              onExport={handleExport}
              t={t}
              stacked
            />
          </MobileSheet>
        </div>

        <div className="mb-4 grid grid-cols-1 gap-2 lg:grid-cols-[1fr_auto] lg:items-center">
          <SegmentedControl
            options={objectiveOptions}
            value={objective}
            onChange={setObjective}
            ariaLabel={t('dashboard.objective')}
            spacious
          />

          <div className="flex min-h-11 flex-wrap items-center gap-2 rounded-xl bg-[#151719]/78 px-3 py-2 text-[12px] text-white/46 ring-1 ring-white/[0.08]">
            <IconBolt size={15} className="text-[#f5c76a]" stroke={2.2} />
            <span className="min-w-0 flex-1 truncate">
              {t(activityMessage.key, activityMessage.params)}
            </span>
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
              {t('dashboard.forecast')}
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
            <div className="grid grid-cols-2 gap-3 md:grid-cols-2 xl:grid-cols-5">
              <MetricCard
                icon={IconShoppingBag}
                label={t('dashboard.controls.revenue')}
                value={formatCurrency(data.summary.revenue, locale)}
                delta={data.summary.revenueDelta}
                meta={
                  showForecast
                    ? t('dashboard.forecast') +
                      ` ${formatCurrency(data.summary.forecastRevenue, locale)}`
                    : t('dashboard.currentWindow')
                }
                accent="#79e4ff"
                sparkline={data.timeseries.map((point) => point.revenue)}
              />
              <MetricCard
                icon={IconTrendingUp}
                label="ROAS"
                value={`${data.summary.roas.toFixed(2)}x`}
                delta={data.summary.roasDelta}
                meta={`${formatCurrency(data.summary.spend, locale)} ${t('dashboard.spend')}`}
                accent="#f5c76a"
                sparkline={data.timeseries.map((point) => point.roas)}
              />
              <MetricCard
                icon={IconTargetArrow}
                label="CVR"
                value={`${data.summary.cvr.toFixed(2)}%`}
                delta={data.summary.cvrDelta}
                meta={t('dashboard.orders', { count: formatNumber(data.summary.orders, locale) })}
                accent="#8dd9a3"
                sparkline={data.timeseries.map((point) => point.cvr)}
              />
              <MetricCard
                icon={IconEye}
                label="3s"
                value={`${data.summary.thumbStop.toFixed(1)}%`}
                delta={4.8}
                meta={t('dashboard.avgWatch', { seconds: data.summary.watchAvg.toFixed(1) })}
                accent="#9da8ff"
                sparkline={data.timeseries.map((point) => point.ctr)}
              />
              <MetricCard
                icon={IconGauge}
                label={t('dashboard.confidence')}
                value={`${data.summary.confidence}%`}
                delta={2.6}
                meta={t('dashboard.factorMeta')}
                accent="#ffb86b"
                sparkline={data.factorMatrix.map((factor) => factor.confidence)}
              />
            </div>

            <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.5fr)_minmax(360px,0.8fr)]">
              <div className="space-y-4">
                <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
                  <SectionHeader
                    icon={IconChartBar}
                    title={t('dashboard.trend')}
                    meta={t('dashboard.refreshed', {
                      date: formatDate(data.generatedAt, locale),
                    })}
                    action={
                      <span className="text-[12px] text-white/40">
                        {t('dashboard.trendMeta', {
                          range:
                            RANGE_OPTIONS.find((option) => option.value === range)?.label ?? range,
                        })}
                      </span>
                    }
                  />
                  <PerformanceChart points={data.timeseries} t={t} />
                </section>

                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[0.9fr_1.1fr]">
                  <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
                    <SectionHeader
                      icon={IconChartPie}
                      title={t('dashboard.funnel')}
                      meta={t('dashboard.funnelMeta')}
                    />
                    <FunnelChart stages={data.funnel} locale={locale} t={t} />
                  </section>

                  <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
                    <SectionHeader icon={IconWorld} title={t('dashboard.geo')} meta="GMV share" />
                    <GeoBreakdownChart items={data.geoBreakdown} locale={locale} t={t} />
                  </section>
                </div>

                <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
                  <SectionHeader
                    icon={IconSparkles}
                    title={t('dashboard.factorTitle')}
                    meta={selectedFactor ? selectedFactor.factor : t('dashboard.factorEmpty')}
                  />
                  <FactorMatrix
                    factors={data.factorMatrix}
                    selectedKey={selectedFactorKey}
                    t={t}
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
                      title={t('dashboard.campaignConsole')}
                      meta={t('dashboard.campaignMeta')}
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <label className="flex h-10 min-w-0 items-center gap-2 rounded-lg bg-white/[0.05] px-3 text-white/42 ring-1 ring-white/[0.08] sm:w-[260px]">
                        <IconSearch size={15} stroke={2.2} />
                        <input
                          value={searchQuery}
                          onChange={(event) => setSearchQuery(event.target.value)}
                          className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/32"
                          placeholder={t('dashboard.searchPlaceholder')}
                        />
                      </label>
                      <button
                        type="button"
                        onClick={handleOptimizeBudget}
                        className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-[#79e4ff] px-3 text-[12px] font-bold text-[#071316] transition-opacity hover:opacity-90"
                      >
                        <IconBolt size={15} stroke={2.5} />
                        {t('dashboard.smartBudget')}
                      </button>
                    </div>
                  </div>
                  <div className="lg:hidden">
                    <CampaignCards
                      campaigns={campaigns}
                      selectedCampaignId={selectedCampaign?.id ?? null}
                      onSelect={(campaign) => setSelectedCampaignId(campaign.id)}
                      onToggle={handleToggleCampaign}
                      onBoost={handleBoostCampaign}
                      locale={locale}
                      t={t}
                    />
                  </div>
                  <div className="hidden lg:block">
                    <CampaignTable
                      campaigns={campaigns}
                      sort={sort}
                      selectedCampaignId={selectedCampaign?.id ?? null}
                      onSort={handleSort}
                      onSelect={(campaign) => setSelectedCampaignId(campaign.id)}
                      onToggle={handleToggleCampaign}
                      onBoost={handleBoostCampaign}
                      locale={locale}
                      t={t}
                    />
                  </div>
                </section>
              </div>

              <aside className="space-y-4">
                <CampaignInspector
                  campaign={selectedCampaign}
                  tests={selectedCampaignTests}
                  locale={locale}
                  t={t}
                  onCopyTracking={handleCopyTracking}
                  onToggle={
                    selectedCampaign ? () => handleToggleCampaign(selectedCampaign) : undefined
                  }
                  onBoost={
                    selectedCampaign ? () => handleBoostCampaign(selectedCampaign) : undefined
                  }
                />
                <RecommendationPanel
                  items={data.recommendations}
                  onApply={handleOptimizeBudget}
                  t={t}
                />
                <TracePanel events={data.trace} t={t} />
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
    <section className="group relative min-h-[150px] overflow-hidden rounded-2xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08] transition-[transform,box-shadow] duration-300 hover:-translate-y-0.5 hover:ring-white/[0.16]">
      {/* accent glow */}
      <span
        aria-hidden
        className="pointer-events-none absolute -right-12 -top-12 h-32 w-32 rounded-full opacity-40 blur-2xl transition-opacity duration-300 group-hover:opacity-70"
        style={{ background: `radial-gradient(circle, ${accent}, transparent 70%)` }}
      />
      {/* accent top hairline */}
      <span
        aria-hidden
        className="pointer-events-none absolute inset-x-0 top-0 h-px"
        style={{ background: `linear-gradient(90deg, transparent, ${accent}66, transparent)` }}
      />

      <div className="relative mb-3 flex items-start justify-between gap-3">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-xl ring-1"
          style={{ backgroundColor: `${accent}1a`, boxShadow: `inset 0 0 0 1px ${accent}33` }}
        >
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
      <div className="relative text-[12px] font-semibold text-white/42">{label}</div>
      <div className="relative mt-1.5 text-[26px] font-bold leading-none tracking-tight text-white">
        {value}
      </div>
      <div className="relative mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0 flex-1 truncate text-[11px] text-white/34">{meta}</div>
        <MiniSparkline values={sparkline} color={accent} />
      </div>
    </section>
  );
}

function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  const gradientId = useId();
  const width = 104;
  const height = 36;
  const points = buildPolylinePoints(values, width, height);
  const areaPoints = `0,${height} ${points} ${width},${height}`;
  const lastY = (() => {
    const last = points.split(' ').pop();
    const y = last?.split(',')[1];
    return y ? Number.parseFloat(y) : height / 2;
  })();
  const lastX = width;
  return (
    <svg
      className="h-[36px] w-[104px] shrink-0 overflow-visible"
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      preserveAspectRatio="none"
    >
      <title>Trend</title>
      <defs>
        <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.32" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill={`url(#${gradientId})`} />
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={lastX} cy={lastY} r="2.4" fill={color} />
      <circle cx={lastX} cy={lastY} r="4.5" fill={color} fillOpacity="0.25" />
    </svg>
  );
}

function PerformanceChart({ points, t }: { points: TiktokDailyPoint[]; t: TFunction }) {
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
        <title>{t('dashboard.trend')}</title>
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
          {t('dashboard.revenue')}
        </text>
        <text x={width - 88} y={14} fill="rgba(245,199,106,0.75)" fontSize="11">
          {t('dashboard.spendBars')}
        </text>
      </svg>
    </div>
  );
}

function FunnelChart({
  stages,
  locale,
  t,
}: {
  stages: TiktokFunnelStage[];
  locale: Locale;
  t: TFunction;
}) {
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
              <span className="text-[11px] text-white/36">
                {formatCompact(stage.value, locale)}
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className={cn('h-full rounded-full', strong ? 'bg-[#79e4ff]' : 'bg-[#ffb86b]')}
                style={{ width: `${width}%` }}
              />
            </div>
            <div className="mt-2 flex items-center justify-between text-[11px]">
              <span className={strong ? 'text-[#8dd9a3]' : 'text-[#ffb86b]'}>{stage.rate}%</span>
              <span className="text-white/28">
                {t('dashboard.benchmark', { value: stage.benchmark })}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function GeoBreakdownChart({
  items,
  locale,
  t,
}: {
  items: TiktokGeoBreakdown[];
  locale: Locale;
  t: TFunction;
}) {
  const maxRevenue = Math.max(...items.map((item) => item.revenue), 1);
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <div key={item.region}>
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <span className="text-[12px] font-semibold text-white/78">{item.region}</span>
            <span className="text-[11px] text-white/38">
              {formatCurrency(item.revenue, locale)} · {item.roas.toFixed(2)}x
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
      {items.length === 0 ? <EmptyState text={t('hotVideos.empty')} /> : null}
    </div>
  );
}

function FactorMatrix({
  factors,
  selectedKey,
  t,
  onSelect,
}: {
  factors: TiktokFactorRow[];
  selectedKey: string | null;
  t: TFunction;
  onSelect: (factor: TiktokFactorRow) => void;
}) {
  const columns = [
    { key: 'ctrLift', label: 'CTR' },
    { key: 'cvrLift', label: 'CVR' },
    { key: 'roasLift', label: 'ROAS' },
    { key: 'retentionLift', label: t('dashboard.retention') },
  ] as const;

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-separate border-spacing-y-2">
        <thead>
          <tr className="text-left text-[11px] uppercase text-white/32">
            <th className="px-3 py-1 font-semibold">{t('dashboard.factor')}</th>
            <th className="px-3 py-1 font-semibold">{t('dashboard.module')}</th>
            <th className="px-3 py-1 font-semibold">{t('dashboard.signal')}</th>
            {columns.map((column) => (
              <th key={column.key} className="px-3 py-1 text-center font-semibold">
                {column.label}
              </th>
            ))}
            <th className="px-3 py-1 text-right font-semibold">{t('dashboard.confidence')}</th>
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
                      {t('dashboard.score', { value: factor.score })}
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

function DashboardFilterControls({
  range,
  region,
  channel,
  regionOptions,
  channelOptions,
  status,
  data,
  onRangeChange,
  onRegionChange,
  onChannelChange,
  onRefresh,
  onExport,
  t,
  stacked = false,
}: {
  range: TiktokDashboardRange;
  region: TiktokDashboardRegion;
  channel: TiktokDashboardChannel;
  regionOptions: { label: string; value: TiktokDashboardRegion }[];
  channelOptions: { label: string; value: TiktokDashboardChannel }[];
  status: DashboardStatus;
  data: TiktokDashboardPayload | null;
  onRangeChange: (value: TiktokDashboardRange) => void;
  onRegionChange: (value: TiktokDashboardRegion) => void;
  onChannelChange: (value: TiktokDashboardChannel) => void;
  onRefresh: () => void;
  onExport: () => void;
  t: TFunction;
  stacked?: boolean;
}) {
  const wrap = stacked ? 'flex flex-col gap-3' : 'flex flex-col gap-2 lg:flex-row lg:items-center';

  return (
    <div className={wrap}>
      <SegmentedControl
        options={RANGE_OPTIONS}
        value={range}
        onChange={onRangeChange}
        ariaLabel={t('dashboard.range')}
        spacious={stacked}
      />
      <SelectControl
        icon={IconWorld}
        value={region}
        options={regionOptions}
        onChange={(value) => onRegionChange(value as TiktokDashboardRegion)}
        ariaLabel={t('dashboard.region')}
      />
      <SelectControl
        icon={IconFilter}
        value={channel}
        options={channelOptions}
        onChange={(value) => onChannelChange(value as TiktokDashboardChannel)}
        ariaLabel={t('dashboard.channel')}
      />
      <button
        type="button"
        onClick={onRefresh}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white/[0.06] px-3 text-[12px] font-semibold text-white/78 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.1]"
      >
        <IconRefresh size={15} stroke={2.2} className={status === 'loading' ? 'animate-spin' : ''} />
        {t('common.refresh')}
      </button>
      <button
        type="button"
        onClick={onExport}
        disabled={!data}
        className="inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-white px-3 text-[12px] font-bold text-[#111315] transition-opacity hover:opacity-90 disabled:opacity-40"
      >
        <IconDownload size={15} stroke={2.4} />
        {t('common.export')}
      </button>
    </div>
  );
}

function CampaignCards({
  campaigns,
  selectedCampaignId,
  onSelect,
  onToggle,
  onBoost,
  locale,
  t,
}: {
  campaigns: TiktokCampaign[];
  selectedCampaignId: string | null;
  onSelect: (campaign: TiktokCampaign) => void;
  onToggle: (campaign: TiktokCampaign) => void;
  onBoost: (campaign: TiktokCampaign) => void;
  locale: Locale;
  t: TFunction;
}) {
  if (campaigns.length === 0) return <EmptyState text={t('dashboard.noCampaigns')} />;

  return (
    <div className="space-y-3">
      {campaigns.map((campaign) => {
        const selected = selectedCampaignId === campaign.id;
        return (
          <article
            key={campaign.id}
            className={cn(
              'rounded-xl p-4 ring-1 transition-colors',
              selected
                ? 'bg-[#14313a] ring-[#79e4ff]/24'
                : 'bg-white/[0.035] ring-white/[0.08]',
            )}
          >
            <button
              type="button"
              onClick={() => onSelect(campaign)}
              className="flex w-full items-start gap-3 text-left"
            >
              <span
                className="h-12 w-12 shrink-0 rounded-lg ring-1 ring-white/[0.08]"
                style={{ background: campaign.thumbnail }}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-bold text-white/88">
                  {campaign.name}
                </span>
                <span className="mt-1 block text-[11px] text-white/38">
                  {campaign.product} · {campaign.regionLabel}
                </span>
                <div className="mt-2 flex flex-wrap gap-2">
                  <StatusBadge status={campaign.status} t={t} />
                  <span className="text-[11px] font-semibold text-[#79e4ff]">
                    ROAS {campaign.metrics.roas.toFixed(2)}x
                  </span>
                  <span className="text-[11px] text-white/48">
                    {formatCurrency(campaign.metrics.revenue, locale)}
                  </span>
                </div>
              </span>
            </button>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={() => onBoost(campaign)}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-lg bg-white/[0.06] text-[12px] font-semibold text-white/72"
              >
                <IconBolt size={14} />
                {t('dashboard.boost')}
              </button>
              <button
                type="button"
                onClick={() => onToggle(campaign)}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-1 rounded-lg bg-white/[0.06] text-[12px] font-semibold text-white/72"
              >
                {campaign.status === 'paused' ? (
                  <IconPlayerPlay size={14} />
                ) : (
                  <IconPlayerPause size={14} />
                )}
                {campaign.status === 'paused' ? t('dashboard.enable') : t('dashboard.pause')}
              </button>
            </div>
          </article>
        );
      })}
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
  locale,
  t,
}: {
  campaigns: TiktokCampaign[];
  sort: SortState;
  selectedCampaignId: string | null;
  onSort: (key: CampaignSortKey) => void;
  onSelect: (campaign: TiktokCampaign) => void;
  onToggle: (campaign: TiktokCampaign) => void;
  onBoost: (campaign: TiktokCampaign) => void;
  locale: Locale;
  t: TFunction;
}) {
  const headers: CampaignSortKey[] = ['revenue', 'roas', 'cvr', 'spend', 'creativeScore'];

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[980px] border-separate border-spacing-y-2">
        <thead>
          <tr className="text-left text-[11px] uppercase text-white/32">
            <th className="px-3 py-1 font-semibold">{t('dashboard.campaign')}</th>
            <th className="px-3 py-1 font-semibold">{t('dashboard.status')}</th>
            <th className="px-3 py-1 font-semibold">{t('dashboard.budget')}</th>
            {headers.map((key) => (
              <th key={key} className="px-3 py-1 text-right font-semibold">
                <button
                  type="button"
                  onClick={() => onSort(key)}
                  className="inline-flex items-center gap-1 transition-colors hover:text-white/72"
                >
                  {sortLabel(key, t)}
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
            <th className="px-3 py-1 text-right font-semibold">{t('dashboard.actions')}</th>
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
                  <StatusBadge status={campaign.status} t={t} />
                </td>
                <td className="px-3 py-3 font-semibold text-white/68">
                  {formatCurrency(campaign.budget, locale)}
                  {t('dashboard.perDay')}
                </td>
                <td className="px-3 py-3 text-right font-bold text-white/82">
                  {formatCurrency(campaign.metrics.revenue, locale)}
                </td>
                <td className="px-3 py-3 text-right text-[#79e4ff]">
                  {campaign.metrics.roas.toFixed(2)}x
                </td>
                <td className="px-3 py-3 text-right text-white/68">
                  {campaign.metrics.cvr.toFixed(2)}%
                </td>
                <td className="px-3 py-3 text-right text-white/50">
                  {formatCurrency(campaign.metrics.spend, locale)}
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
                      {t('dashboard.boost')}
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
                      {campaign.status === 'paused' ? t('dashboard.enable') : t('dashboard.pause')}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {campaigns.length === 0 ? <EmptyState text={t('dashboard.noCampaigns')} /> : null}
    </div>
  );
}

function CampaignInspector({
  campaign,
  tests,
  locale,
  t,
  onCopyTracking,
  onToggle,
  onBoost,
}: {
  campaign: TiktokCampaign | null;
  tests: TiktokAbTest[];
  locale: Locale;
  t: TFunction;
  onCopyTracking: () => void;
  onToggle?: () => void;
  onBoost?: () => void;
}) {
  if (!campaign) {
    return (
      <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
        <EmptyState text={t('dashboard.chooseCampaign')} />
      </section>
    );
  }

  return (
    <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
      <SectionHeader
        icon={IconSettings}
        title={t('dashboard.creativeDiagnosis')}
        meta={campaign.product}
      />
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
            <div className="mt-1 text-[10px] text-white/58">
              {t('dashboard.hold', { value: campaign.metrics.holdRate })}
            </div>
          </div>
        </div>

        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={campaign.status} t={t} />
            <span className="rounded-full bg-white/[0.05] px-2 py-1 text-[11px] font-semibold text-white/44">
              {campaign.stage}
            </span>
          </div>
          <h3 className="mt-3 text-[16px] font-bold leading-5 text-white">{campaign.name}</h3>
          <p className="mt-2 text-[12px] leading-5 text-white/46">{campaign.hook}</p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <MiniMetric label="ROAS" value={`${campaign.metrics.roas.toFixed(2)}x`} />
            <MiniMetric label="CPA" value={formatCurrency(campaign.metrics.cpa, locale)} />
            <MiniMetric label={t('dashboard.fatigue')} value={`${campaign.fatigue}%`} />
            <MiniMetric
              label={t('dashboard.dailyBudget')}
              value={formatCurrency(campaign.budget, locale)}
            />
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {campaign.factors.map((factor) => (
              <span
                key={factor}
                className="rounded-full bg-[#79e4ff]/10 px-2 py-1 text-[11px] font-semibold text-[#bff4ff] ring-1 ring-[#79e4ff]/18"
              >
                {getTiktokFactorLabel(factor, locale)}
              </span>
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg bg-white/[0.035] p-3 ring-1 ring-white/[0.04]">
        <div className="text-[11px] font-bold uppercase text-white/30">
          {t('dashboard.sourceTitle')}
        </div>
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
          {t('dashboard.copyTracking')}
        </button>
        <button
          type="button"
          onClick={onBoost}
          className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-[#79e4ff] text-[11px] font-bold text-[#071316] transition-opacity hover:opacity-90"
        >
          <IconBolt size={14} />
          {t('dashboard.addBudget')}
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
          {campaign.status === 'paused' ? t('dashboard.enable') : t('dashboard.pause')}
        </button>
      </div>

      <div className="mt-4">
        <div className="mb-2 text-[12px] font-bold text-white/72">{t('dashboard.abTitle')}</div>
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
  t,
}: {
  items: TiktokRecommendation[];
  onApply: () => void;
  t: TFunction;
}) {
  return (
    <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
      <SectionHeader
        icon={IconTargetArrow}
        title={t('dashboard.growthAdvice')}
        meta={t('dashboard.agentAttribution')}
        action={
          <button
            type="button"
            onClick={onApply}
            className="rounded-lg bg-white/[0.06] px-2.5 py-1.5 text-[11px] font-bold text-white/68 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.1]"
          >
            {t('dashboard.applyAll')}
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
                {t('dashboard.confidenceSuffix', { value: item.confidence })}
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

function TracePanel({ events, t }: { events: TiktokTraceEvent[]; t: TFunction }) {
  return (
    <section className="rounded-xl bg-[#151719]/86 p-4 ring-1 ring-white/[0.08]">
      <SectionHeader
        icon={IconCalendarStats}
        title={t('dashboard.traceTitle')}
        meta={t('dashboard.traceMeta')}
      />
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

function StatusBadge({ status, t }: { status: TiktokCampaign['status']; t: TFunction }) {
  const label =
    status === 'active'
      ? t('dashboard.controls.active')
      : status === 'learning'
        ? t('dashboard.controls.learning')
        : t('dashboard.controls.paused');
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

function sortLabel(key: CampaignSortKey, t: TFunction) {
  const labelKey = SORT_LABEL_KEYS[key];
  if (labelKey === 'ROAS' || labelKey === 'CVR') return labelKey;
  return t(`dashboard.controls.${labelKey}`);
}

function formatCurrency(value: number, locale: Locale) {
  const numberLocale = toNumberLocale(locale);
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 10_000) {
    return new Intl.NumberFormat(numberLocale, {
      style: 'currency',
      currency: 'USD',
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  }
  return new Intl.NumberFormat(numberLocale, {
    style: 'currency',
    currency: 'USD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(toNumberLocale(locale)).format(value);
}

function formatCompact(value: number, locale: Locale) {
  return new Intl.NumberFormat(toNumberLocale(locale), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return locale === 'zh' ? '刚刚' : 'Just now';
  return new Intl.DateTimeFormat(toNumberLocale(locale), {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function toNumberLocale(locale: Locale) {
  return locale === 'zh' ? 'zh-CN' : 'en-US';
}
