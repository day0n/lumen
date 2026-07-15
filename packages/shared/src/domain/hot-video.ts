export type HotVideoStatus = 'active' | 'hidden';
export type HotVideoSourcePlatform = 'tiktok' | 'fastmoss' | 'manual';

export interface HotVideoMetricsRecord {
  sales: number;
  revenueUsd: number;
  revenueLabel: string;
  viewsCount: number;
  viewsLabel: string;
  roas: number;
}

export interface HotVideoAnalysisRecord {
  hook: string;
  angle: string;
  score: number;
  tags: string[];
  structure: string[];
}

export interface HotVideoRecord {
  id: string;
  ownerUserId?: string;
  sourcePlatform: HotVideoSourcePlatform;
  sourceUrl?: string;
  externalId?: string;
  title: string;
  productName: string;
  authorHandle?: string;
  thumbnailUrl?: string;
  previewUrl?: string;
  region: string;
  category: string;
  videoType: string;
  paletteCss: string;
  accentColor: string;
  metrics: HotVideoMetricsRecord;
  analysis: HotVideoAnalysisRecord;
  publishedAt: string;
  status: HotVideoStatus;
  createdAt: string;
  updatedAt: string;
}
