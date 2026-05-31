import 'server-only';

import { type HomeFeaturedItemRecord, HomeFeaturedItemRecordSchema } from '@lumen/db';
import { z } from 'zod';

import { getHomeFeaturedRepository, getStudioCache } from './db';
import { traceStudioStep } from './telemetry';

const HOME_FEATURED_CACHE_KEY = 'home:featured:v1';
const HOME_FEATURED_CACHE_TTL_SECONDS = 300; // 5 min

const HomeFeaturedListSchema = z.array(HomeFeaturedItemRecordSchema);

export async function listHomeFeaturedItems(): Promise<HomeFeaturedItemRecord[]> {
  const cache = getStudioCache();
  const cached = await traceStudioStep('studio.home.featured.cache_get', 'cache.get', () =>
    cache.get(HOME_FEATURED_CACHE_KEY, HomeFeaturedListSchema),
  );
  if (cached) return cached;

  const repository = await traceStudioStep(
    'studio.home.featured.repository',
    'db.connect',
    getHomeFeaturedRepository,
  );
  const items = await traceStudioStep('studio.home.featured.db', 'db.query', () =>
    repository.listActive(),
  );
  await traceStudioStep('studio.home.featured.cache_set', 'cache.set', () =>
    cache.set(HOME_FEATURED_CACHE_KEY, items, HOME_FEATURED_CACHE_TTL_SECONDS),
  );
  return items;
}

export async function invalidateHomeFeaturedCache(): Promise<void> {
  await getStudioCache().delete(HOME_FEATURED_CACHE_KEY);
}
