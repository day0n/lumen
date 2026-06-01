import 'server-only';

import { createHash } from 'node:crypto';

import {
  type HotVideoRecord,
  HotVideoRecordSchema,
  type ListHotVideosInput,
  ListHotVideosInputSchema,
  type ListHotVideosResult,
} from '@lumen/db';
import { z } from 'zod';

import type { Locale } from '@/i18n/routing';
import { getHotVideoRepository, getStudioCache } from './db';
import { traceStudioStep } from './telemetry';
import { TikTokScrapeError, isTikTokUrl, scrapeTikTokVideo } from './tiktokScraper';

const LIST_CACHE_TTL_SECONDS = 60;
const DETAIL_CACHE_TTL_SECONDS = 600;

const HotVideoListResultSchema = z
  .object({
    items: z.array(HotVideoRecordSchema),
    total: z.number().int().nonnegative(),
  })
  .strict();

export async function listHotVideos(
  input: ListHotVideosInput,
  locale: Locale = 'en',
): Promise<ListHotVideosResult> {
  const parsed = ListHotVideosInputSchema.parse(input);
  const cache = getStudioCache();
  const cacheKey = `hot-videos:list:${locale}:${hashInput(parsed)}`;

  const cached = await traceStudioStep(
    'studio.hot_videos.list.cache_get',
    'cache.get',
    () => cache.get(cacheKey, HotVideoListResultSchema),
    {
      'lumen.hot_videos.limit': parsed.limit,
      'lumen.hot_videos.skip': parsed.skip,
      'lumen.hot_videos.has_query': Boolean(parsed.query),
      'lumen.hot_videos.owner_scope': parsed.ownerScope ?? 'all',
    },
  );
  if (cached) return cached;

  const repository = await traceStudioStep(
    'studio.hot_videos.repository',
    'db.connect',
    getHotVideoRepository,
  );
  const result = await traceStudioStep('studio.hot_videos.list.db', 'db.query', () =>
    repository.list(parsed, locale),
  );
  await traceStudioStep('studio.hot_videos.list.cache_set', 'cache.set', () =>
    cache.set(cacheKey, result, LIST_CACHE_TTL_SECONDS),
  );
  return result;
}

export async function getHotVideo(
  id: string,
  locale: Locale = 'en',
): Promise<HotVideoRecord | null> {
  const cache = getStudioCache();
  const cacheKey = `hot-videos:detail:${locale}:${id}`;
  const cached = await traceStudioStep('studio.hot_videos.detail.cache_get', 'cache.get', () =>
    cache.get(cacheKey, HotVideoRecordSchema),
  );
  if (cached) return cached;

  const repository = await traceStudioStep(
    'studio.hot_videos.repository',
    'db.connect',
    getHotVideoRepository,
  );
  const video = await traceStudioStep('studio.hot_videos.detail.db', 'db.query', () =>
    repository.getById(id, locale),
  );
  if (video) {
    await traceStudioStep('studio.hot_videos.detail.cache_set', 'cache.set', () =>
      cache.set(cacheKey, video, DETAIL_CACHE_TTL_SECONDS),
    );
  }
  return video;
}

export async function ingestHotVideoFromUrl(
  rawUrl: string,
  options: { ownerUserId?: string; locale?: Locale } = {},
): Promise<HotVideoRecord> {
  const locale = options.locale ?? 'en';
  const url = rawUrl.trim();
  if (!url) {
    throw new TikTokScrapeError(locale === 'zh' ? '请提供视频链接' : 'Please provide a video link');
  }
  if (!isTikTokUrl(url)) {
    throw new TikTokScrapeError(
      locale === 'zh'
        ? '暂时只支持 TikTok 视频链接'
        : 'Only TikTok video links are supported for now',
    );
  }

  const repository = await traceStudioStep(
    'studio.hot_videos.repository',
    'db.connect',
    getHotVideoRepository,
  );
  const scraped = await traceStudioStep('studio.hot_videos.scrape', 'http.client', () =>
    scrapeTikTokVideo(url, { locale }),
  );

  const externalId = scraped.input.externalId;
  if (externalId) {
    const existing = await traceStudioStep('studio.hot_videos.find_existing.db', 'db.query', () =>
      repository.findByExternalId(scraped.input.sourcePlatform, externalId),
    );
    if (existing) return existing;
  }

  const created = await traceStudioStep('studio.hot_videos.create.db', 'db.write', () =>
    repository.create({
      ...scraped.input,
      ownerUserId: options.ownerUserId,
    }),
  );
  await invalidateListCache();
  return created;
}

async function invalidateListCache(): Promise<void> {
  const cache = getStudioCache();
  await cache.deletePattern('hot-videos:list:*', 'lumen:studio:');
}

function hashInput(input: ListHotVideosInput): string {
  const stable = JSON.stringify(input, Object.keys(input).sort());
  return createHash('sha1').update(stable).digest('hex').slice(0, 16);
}
