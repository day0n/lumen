import { randomUUID } from 'node:crypto';

import type { Db } from 'mongodb';

import {
  type CreateHomeFeaturedItemInput,
  CreateHomeFeaturedItemInputSchema,
  type HomeFeaturedItemDocument,
  HomeFeaturedItemDocumentSchema,
  type HomeFeaturedItemRecord,
  HomeFeaturedItemRecordSchema,
  type HomeFeaturedTranslations,
} from '../schema/homeFeatured.js';

const COLLECTION = 'studio_home_featured_items';
type ContentLocale = 'en' | 'zh';

export class HomeFeaturedRepository {
  constructor(private readonly db: Db) {}

  async ensureIndexes(): Promise<void> {
    const collection = this.collection();
    await collection.createIndex({ status: 1, sort_order: 1 });
  }

  async listActive(limit = 12, locale: ContentLocale = 'en'): Promise<HomeFeaturedItemRecord[]> {
    const documents = await this.collection()
      .find({ status: 'active' })
      .sort({ sort_order: 1, _id: 1 })
      .limit(limit)
      .toArray();
    return documents.map((document) => toRecord(document, locale));
  }

  async create(input: CreateHomeFeaturedItemInput): Promise<HomeFeaturedItemRecord> {
    const parsed = CreateHomeFeaturedItemInputSchema.parse(input);
    const now = new Date();
    const document = HomeFeaturedItemDocumentSchema.parse({
      _id: randomUUID(),
      badge: parsed.badge,
      title: parsed.title,
      subtitle: parsed.subtitle,
      description: parsed.description,
      stats_label: parsed.statsLabel,
      cta_label: parsed.ctaLabel,
      translations: parsed.translations,
      cta_href: parsed.ctaHref,
      cover_url: parsed.coverUrl,
      background_css: parsed.backgroundCss,
      accent_color: parsed.accentColor,
      stills: parsed.stills ?? [],
      sort_order: parsed.sortOrder ?? 0,
      status: parsed.status ?? 'active',
      created_at: now,
      updated_at: now,
    });

    await this.collection().insertOne(document);
    return toRecord(document, 'en');
  }

  async deleteAll(): Promise<void> {
    await this.collection().deleteMany({});
  }

  private collection() {
    return this.db.collection<HomeFeaturedItemDocument>(COLLECTION);
  }
}

function toRecord(
  document: HomeFeaturedItemDocument,
  locale: ContentLocale,
): HomeFeaturedItemRecord {
  const parsed = HomeFeaturedItemDocumentSchema.parse(document);
  const translation = readTranslation(parsed.translations, locale);
  return HomeFeaturedItemRecordSchema.parse({
    id: parsed._id,
    badge: translation.badge ?? parsed.badge,
    title: translation.title ?? parsed.title,
    subtitle: translation.subtitle ?? parsed.subtitle,
    description: translation.description ?? parsed.description,
    statsLabel: translation.statsLabel ?? parsed.stats_label,
    ctaLabel: translation.ctaLabel ?? parsed.cta_label,
    ctaHref: parsed.cta_href,
    coverUrl: parsed.cover_url,
    backgroundCss: parsed.background_css,
    accentColor: parsed.accent_color,
    stills: parsed.stills,
    sortOrder: parsed.sort_order,
    status: parsed.status,
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
  });
}

function readTranslation(
  translations: HomeFeaturedTranslations | undefined,
  locale: ContentLocale,
) {
  return translations?.[locale] ?? translations?.en ?? {};
}
