import 'server-only';

import { type HomeFeaturedItemRecord, HomeFeaturedItemRecordSchema } from '@lumen/db';
import { z } from 'zod';

import type { Locale } from '@/i18n/routing';
import { getHomeFeaturedRepository, getStudioCache } from './db';
import { traceStudioStep } from './telemetry';

const HOME_FEATURED_CACHE_KEY_PREFIX = 'home:featured:v2';
const HOME_FEATURED_CACHE_TTL_SECONDS = 300; // 5 min

const HomeFeaturedListSchema = z.array(HomeFeaturedItemRecordSchema);

export async function listHomeFeaturedItems(
  locale: Locale = 'en',
): Promise<HomeFeaturedItemRecord[]> {
  const cache = getStudioCache();
  const cacheKey = `${HOME_FEATURED_CACHE_KEY_PREFIX}:${locale}`;
  const cached = await traceStudioStep('studio.home.featured.cache_get', 'cache.get', () =>
    cache.get(cacheKey, HomeFeaturedListSchema),
  );
  if (cached) return cached;

  const repository = await traceStudioStep(
    'studio.home.featured.repository',
    'db.connect',
    getHomeFeaturedRepository,
  );
  const items = await traceStudioStep('studio.home.featured.db', 'db.query', () =>
    repository.listActive(12, locale),
  );
  await traceStudioStep('studio.home.featured.cache_set', 'cache.set', () =>
    cache.set(cacheKey, items, HOME_FEATURED_CACHE_TTL_SECONDS),
  );
  return items;
}

export async function invalidateHomeFeaturedCache(): Promise<void> {
  await Promise.all([
    getStudioCache().delete(`${HOME_FEATURED_CACHE_KEY_PREFIX}:en`),
    getStudioCache().delete(`${HOME_FEATURED_CACHE_KEY_PREFIX}:zh`),
  ]);
}
