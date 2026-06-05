import type { Locale } from '@/i18n/routing';
import type {
  TiktokCampaign,
  TiktokFactorRow,
  TiktokFunnelStage,
} from '@/lib/tiktok-dashboard-mock';

export type CampaignSortKey = 'revenue' | 'roas' | 'cvr' | 'spend' | 'creativeScore';
export type SortDirection = 'asc' | 'desc';

export interface CampaignEdit {
  status?: TiktokCampaign['status'];
  budgetDelta?: number;
}

export interface SortState {
  key: CampaignSortKey;
  direction: SortDirection;
}

export function applyCampaignEdit(campaign: TiktokCampaign, edit?: CampaignEdit): TiktokCampaign {
  if (!edit) return campaign;
  return {
    ...campaign,
    status: edit.status ?? campaign.status,
    budget: Math.max(80, campaign.budget + (edit.budgetDelta ?? 0)),
  };
}

export function readSortValue(campaign: TiktokCampaign, key: CampaignSortKey) {
  if (key === 'creativeScore') return campaign.creativeScore;
  return campaign.metrics[key];
}

export function factorToFunnelStageIndex(
  factor: TiktokFactorRow,
  stages: TiktokFunnelStage[],
): number {
  const lifts = [factor.ctrLift, factor.cvrLift, factor.roasLift, factor.retentionLift];
  const maxLift = Math.max(...lifts);
  const maxIdx = lifts.indexOf(maxLift);
  return Math.min(Math.max(maxIdx, 0), Math.max(stages.length - 1, 0));
}

export function campaignMatchesFactor(campaign: TiktokCampaign, factorKey: string | null) {
  if (!factorKey) return true;
  return campaign.factors.includes(factorKey);
}

export function buildPolylinePoints(values: number[], width: number, height: number) {
  if (values.length === 0) return '';
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(max - min, 1);
  return values
    .map((value, index) => {
      const x = (index / Math.max(values.length - 1, 1)) * width;
      const y = height - ((value - min) / range) * (height - 4) - 2;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

export function toNumberLocale(locale: Locale) {
  return locale === 'zh' ? 'zh-CN' : 'en-US';
}

export function formatCurrency(value: number, locale: Locale) {
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

export function formatNumber(value: number, locale: Locale) {
  return new Intl.NumberFormat(toNumberLocale(locale)).format(value);
}

export function formatCompact(value: number, locale: Locale) {
  return new Intl.NumberFormat(toNumberLocale(locale), {
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

export function formatDate(value: string, locale: Locale) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return locale === 'zh' ? '刚刚' : 'Just now';
  return new Intl.DateTimeFormat(toNumberLocale(locale), {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}
