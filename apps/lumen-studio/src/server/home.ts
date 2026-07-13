import 'server-only';

import type { HomeFeaturedItemRecord } from '@lumen/db';

import type { Locale } from '@/i18n/routing';
import { getStudioHomeQueryService } from './homeQueries';

export async function listHomeFeaturedItems(
  locale: Locale = 'en',
): Promise<HomeFeaturedItemRecord[]> {
  return getStudioHomeQueryService().listFeatured(locale);
}

export async function invalidateHomeFeaturedCache(): Promise<void> {
  await getStudioHomeQueryService().invalidateFeatured();
}
