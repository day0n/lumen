import type {
  TiktokDashboardChannel,
  TiktokDashboardObjective,
  TiktokDashboardRange,
  TiktokDashboardRegion,
} from '@/lib/tiktok-dashboard-mock';
import type { CampaignSortKey } from './utils';

export const RANGE_OPTIONS: { label: string; value: TiktokDashboardRange }[] = [
  { label: '7D', value: '7d' },
  { label: '14D', value: '14d' },
  { label: '30D', value: '30d' },
  { label: '90D', value: '90d' },
];

export const REGION_OPTIONS: { labelKey: string; value: TiktokDashboardRegion }[] = [
  { labelKey: 'global', value: 'global' },
  { labelKey: 'us', value: 'us' },
  { labelKey: 'sea', value: 'sea' },
  { labelKey: 'uk', value: 'uk' },
  { labelKey: 'de', value: 'de' },
];

export const CHANNEL_OPTIONS: { labelKey: string; label?: string; value: TiktokDashboardChannel }[] =
  [
    { labelKey: 'allChannels', value: 'all' },
    { labelKey: 'spark_ads', label: 'Spark Ads', value: 'spark_ads' },
    { labelKey: 'creator', value: 'creator_whitelist' },
    { labelKey: 'retargeting', value: 'retargeting' },
    { labelKey: 'live_boost', label: 'Live Boost', value: 'live_boost' },
  ];

export const OBJECTIVE_OPTIONS: { labelKey: string; value: TiktokDashboardObjective }[] = [
  { labelKey: 'sales', value: 'sales' },
  { labelKey: 'roas', value: 'roas' },
  { labelKey: 'cold', value: 'cold_start' },
  { labelKey: 'creative', value: 'creative_test' },
];

export const SORT_LABEL_KEYS: Record<CampaignSortKey, string> = {
  revenue: 'revenue',
  roas: 'ROAS',
  cvr: 'CVR',
  spend: 'spend',
  creativeScore: 'creativeScore',
};

export type DashboardSectionTarget =
  | 'trend'
  | 'funnel'
  | 'factors'
  | 'campaigns'
  | 'recommendations';
