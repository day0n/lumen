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

import { getHotVideoRepository, getStudioCache } from './db';
import { TikTokScrapeError, isTikTokUrl, scrapeTikTokVideo } from './tiktokScraper';

const LIST_CACHE_TTL_SECONDS = 60;
const DETAIL_CACHE_TTL_SECONDS = 600;

const HotVideoListResultSchema = z
  .object({
    items: z.array(HotVideoRecordSchema),
    total: z.number().int().nonnegative(),
  })
  .strict();

export async function listHotVideos(input: ListHotVideosInput): Promise<ListHotVideosResult> {
  const parsed = ListHotVideosInputSchema.parse(input);
  const cache = getStudioCache();
  const cacheKey = `hot-videos:list:${hashInput(parsed)}`;

  const cached = await cache.get(cacheKey, HotVideoListResultSchema);
  if (cached) return cached;

  const repository = await getHotVideoRepository();
  const result = await repository.list(parsed);
  await cache.set(cacheKey, result, LIST_CACHE_TTL_SECONDS);
  return result;
}

export async function getHotVideo(id: string): Promise<HotVideoRecord | null> {
  const cache = getStudioCache();
  const cacheKey = `hot-videos:detail:${id}`;
  const cached = await cache.get(cacheKey, HotVideoRecordSchema);
  if (cached) return cached;

  const repository = await getHotVideoRepository();
  const video = await repository.getById(id);
  if (video) await cache.set(cacheKey, video, DETAIL_CACHE_TTL_SECONDS);
  return video;
}

export async function ingestHotVideoFromUrl(
  rawUrl: string,
  options: { ownerUserId?: string } = {},
): Promise<HotVideoRecord> {
  const url = rawUrl.trim();
  if (!url) {
    throw new TikTokScrapeError('请提供视频链接');
  }
  if (!isTikTokUrl(url)) {
    throw new TikTokScrapeError('暂时只支持 TikTok 视频链接');
  }

  const repository = await getHotVideoRepository();
  const scraped = await scrapeTikTokVideo(url);

  if (scraped.input.externalId) {
    const existing = await repository.findByExternalId(
      scraped.input.sourcePlatform,
      scraped.input.externalId,
    );
    if (existing) return existing;
  }

  const created = await repository.create({
    ...scraped.input,
    ownerUserId: options.ownerUserId,
  });
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
