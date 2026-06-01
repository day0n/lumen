import 'server-only';

import type { CreateHotVideoInput } from '@lumen/db';

import type { Locale } from '@/i18n/routing';
import { getStudioServerConfig } from './config';
import { isObjectStorageConfigured, uploadFromUrl } from './objectStorage';

const APIFY_ENDPOINT =
  'https://api.apify.com/v2/acts/clockworks~tiktok-scraper/run-sync-get-dataset-items';
const ACTOR_TIMEOUT_SECONDS = 180;

const DEFAULT_PALETTES: Array<{ palette: string; accent: string }> = [
  {
    palette:
      'radial-gradient(circle at 24% 20%,rgba(151,204,173,0.72),transparent 32%),linear-gradient(145deg,#172019 0%,#49614c 50%,#111315 100%)',
    accent: '#97ccad',
  },
  {
    palette:
      'radial-gradient(circle at 72% 16%,rgba(157,168,255,0.7),transparent 30%),linear-gradient(145deg,#171720 0%,#464b68 48%,#101214 100%)',
    accent: '#9da8ff',
  },
  {
    palette:
      'radial-gradient(circle at 22% 22%,rgba(121,228,255,0.68),transparent 32%),linear-gradient(145deg,#122027 0%,#315464 52%,#0d1114 100%)',
    accent: '#79e4ff',
  },
  {
    palette:
      'radial-gradient(circle at 78% 20%,rgba(230,183,207,0.72),transparent 30%),linear-gradient(145deg,#23191f 0%,#6e5665 48%,#111315 100%)',
    accent: '#e6b7cf',
  },
  {
    palette:
      'radial-gradient(circle at 28% 18%,rgba(247,206,90,0.78),transparent 28%),linear-gradient(145deg,#1d2427 0%,#5a6d72 46%,#151719 100%)',
    accent: '#f5c76a',
  },
];

interface TikTokScrapeItem {
  id?: string;
  text?: string;
  webVideoUrl?: string;
  createTimeISO?: string;
  playCount?: number;
  diggCount?: number;
  shareCount?: number;
  commentCount?: number;
  authorMeta?: {
    name?: string;
    nickName?: string;
    avatar?: string;
    region?: string;
  };
  videoMeta?: {
    coverUrl?: string;
    originalCoverUrl?: string;
    duration?: number;
    /** Direct CDN URL — short-lived signed URL */
    downloadAddr?: string;
    playAddr?: string;
  };
  /** Apify-hosted media URLs when shouldDownloadVideos:true */
  mediaUrls?: string[];
  hashtags?: Array<{ name?: string } | string>;
}

export interface ScrapedHotVideo {
  input: CreateHotVideoInput;
  raw: TikTokScrapeItem;
}

export class TikTokScrapeError extends Error {
  constructor(
    message: string,
    public readonly reason?: unknown,
  ) {
    super(message);
    this.name = 'TikTokScrapeError';
  }
}

export function isTikTokUrl(value: string): boolean {
  return /tiktok\.com\//i.test(value);
}

export async function scrapeTikTokVideo(
  url: string,
  options: { locale?: Locale } = {},
): Promise<ScrapedHotVideo> {
  const locale = options.locale ?? 'en';
  const config = getStudioServerConfig();
  if (!config.APIFY_API_TOKEN) {
    throw new TikTokScrapeError(
      locale === 'zh'
        ? 'APIFY_API_TOKEN 未配置，无法解析 TikTok 链接'
        : 'APIFY_API_TOKEN is not configured, so TikTok links cannot be parsed',
    );
  }
  if (!isTikTokUrl(url)) {
    throw new TikTokScrapeError(
      locale === 'zh' ? '链接不是 TikTok 视频地址' : 'The link is not a TikTok video URL',
    );
  }

  const wantStorage = isObjectStorageConfigured();

  const endpoint = new URL(APIFY_ENDPOINT);
  endpoint.searchParams.set('token', config.APIFY_API_TOKEN);
  endpoint.searchParams.set('timeout', String(ACTOR_TIMEOUT_SECONDS));

  const body = {
    postURLs: [url],
    resultsPerPage: 1,
    shouldDownloadVideos: wantStorage,
    shouldDownloadCovers: true,
    shouldDownloadSlideshowImages: false,
    shouldDownloadSubtitles: false,
  };

  let response: Response;
  try {
    response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(ACTOR_TIMEOUT_SECONDS * 1000 + 5000),
    });
  } catch (error) {
    throw new TikTokScrapeError(
      locale === 'zh'
        ? 'Apify 请求失败（超时或网络错误）'
        : 'Apify request failed due to timeout or network error',
      error,
    );
  }

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new TikTokScrapeError(
      locale === 'zh'
        ? `Apify 返回 ${response.status}: ${text.slice(0, 200)}`
        : `Apify returned ${response.status}: ${text.slice(0, 200)}`,
    );
  }

  const items = (await response.json().catch(() => null)) as TikTokScrapeItem[] | null;
  if (!Array.isArray(items) || items.length === 0) {
    throw new TikTokScrapeError(
      locale === 'zh'
        ? 'TikTok 返回空结果，请确认链接是否有效'
        : 'TikTok returned no results. Please confirm the link is valid.',
    );
  }

  const item = items[0];
  if (!item) {
    throw new TikTokScrapeError(
      locale === 'zh'
        ? 'TikTok 返回空结果，请确认链接是否有效'
        : 'TikTok returned no results. Please confirm the link is valid.',
    );
  }

  const externalId = item.id ?? '';
  const mediaPrefix = `hot-videos/${externalId || 'unknown'}`;

  let storedThumbnail: string | undefined;
  let storedPreview: string | undefined;

  if (wantStorage) {
    const coverSource = item.videoMeta?.coverUrl || item.videoMeta?.originalCoverUrl || '';
    if (coverSource) {
      try {
        const result = await uploadFromUrl({
          sourceUrl: coverSource,
          prefix: `${mediaPrefix}/cover`,
          extension: 'jpg',
          fallbackContentType: 'image/jpeg',
          maxBytes: 20 * 1024 * 1024,
        });
        storedThumbnail = result.url;
      } catch (error) {
        // Cover transfer is best-effort; fall back to original URL below.
        console.warn('[tiktok] cover upload failed:', error);
      }
    }

    const videoSource = pickVideoSource(item);
    if (videoSource) {
      try {
        const result = await uploadFromUrl({
          sourceUrl: videoSource,
          prefix: `${mediaPrefix}/video`,
          extension: 'mp4',
          fallbackContentType: 'video/mp4',
        });
        storedPreview = result.url;
      } catch (error) {
        console.warn('[tiktok] video upload failed:', error);
      }
    }
  }

  return {
    input: mapToCreateInput(item, url, {
      locale,
      thumbnailUrl: storedThumbnail,
      previewUrl: storedPreview,
    }),
    raw: item,
  };
}

function pickVideoSource(item: TikTokScrapeItem): string {
  for (const candidate of item.mediaUrls ?? []) {
    if (typeof candidate === 'string' && candidate.startsWith('http')) {
      return candidate;
    }
  }
  return item.videoMeta?.downloadAddr || item.videoMeta?.playAddr || '';
}

function mapToCreateInput(
  item: TikTokScrapeItem,
  fallbackUrl: string,
  overrides: { locale?: Locale; thumbnailUrl?: string; previewUrl?: string } = {},
): CreateHotVideoInput {
  const locale = overrides.locale ?? 'en';
  const palette = pickPalette(item.id ?? fallbackUrl);
  const text = (item.text ?? '').trim();
  const title = truncate(text || (locale === 'zh' ? 'TikTok 视频' : 'TikTok video'), 240);
  const author = item.authorMeta?.nickName || item.authorMeta?.name || 'TikTok creator';
  const productName = truncate(text.split(/[#\n]/)[0]?.trim() || author, 120);
  const tags = extractTags(item);
  const views = item.playCount ?? 0;
  const likes = item.diggCount ?? 0;
  const publishedAt = parseDate(item.createTimeISO);
  const fallbackCover = item.videoMeta?.coverUrl || item.videoMeta?.originalCoverUrl || '';
  const thumbnailUrl = overrides.thumbnailUrl || fallbackCover || undefined;
  const previewUrl = overrides.previewUrl || undefined;
  const sourceUrl = item.webVideoUrl || fallbackUrl;

  return {
    sourcePlatform: 'tiktok',
    sourceUrl,
    externalId: item.id ? `tiktok:${item.id}` : undefined,
    title,
    productName,
    authorHandle: item.authorMeta?.name ? `@${item.authorMeta.name}` : undefined,
    thumbnailUrl,
    previewUrl,
    region: item.authorMeta?.region || (locale === 'zh' ? '未知' : 'Unknown'),
    category: locale === 'zh' ? '未分类' : 'Uncategorized',
    videoType: locale === 'zh' ? '用户原创' : 'User generated',
    paletteCss: palette.palette,
    accentColor: palette.accent,
    metrics: {
      sales: 0,
      revenueUsd: 0,
      revenueLabel: '—',
      viewsCount: views,
      viewsLabel: formatCount(views, locale),
      roas: 0,
    },
    analysis: {
      hook: truncate(text, 280),
      angle:
        likes > 0
          ? locale === 'zh'
            ? `点赞 ${formatCount(likes, locale)} · 浏览 ${formatCount(views, locale)}`
            : `${formatCount(likes, locale)} likes · ${formatCount(views, locale)} views`
          : locale === 'zh'
            ? '待 AI 拆解'
            : 'Pending AI breakdown',
      score: 0,
      tags,
      structure: [],
    },
    publishedAt,
  };
}

function pickPalette(seed: string): { palette: string; accent: string } {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  const slot = DEFAULT_PALETTES[hash % DEFAULT_PALETTES.length];
  return slot ?? DEFAULT_PALETTES[0]!;
}

function extractTags(item: TikTokScrapeItem): string[] {
  const tags: string[] = [];
  for (const entry of item.hashtags ?? []) {
    const name = typeof entry === 'string' ? entry : entry?.name;
    if (!name) continue;
    const clean = name.replace(/^#/, '').trim();
    if (clean) tags.push(truncate(clean, 40));
    if (tags.length >= 8) break;
  }
  return tags;
}

function formatCount(value: number, locale: Locale): string {
  if (!Number.isFinite(value) || value <= 0) return '0';
  if (locale === 'en') {
    return new Intl.NumberFormat('en-US', {
      notation: 'compact',
      maximumFractionDigits: 1,
    }).format(value);
  }
  if (value >= 10_000) {
    const wan = value / 10_000;
    return `${wan >= 100 ? wan.toFixed(0) : wan.toFixed(2)}万`;
  }
  return value.toLocaleString('zh-CN');
}

function parseDate(value: string | undefined): Date {
  if (!value) return new Date();
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max - 1)}…`;
}
