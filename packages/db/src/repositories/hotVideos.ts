import { randomUUID } from 'node:crypto';

import type { Db, Document, Filter } from 'mongodb';

import {
  type CreateHotVideoInput,
  CreateHotVideoInputSchema,
  type HotVideoDocument,
  HotVideoDocumentSchema,
  type HotVideoRecord,
  HotVideoRecordSchema,
  type HotVideoTranslations,
  type ListHotVideosInput,
  ListHotVideosInputSchema,
} from '../schema/hotVideos';

const COLLECTION = 'studio_hot_videos';
type ContentLocale = 'en' | 'zh';

export interface ListHotVideosResult {
  items: HotVideoRecord[];
  total: number;
}

export class HotVideoRepository {
  constructor(private readonly db: Db) {}

  async ensureIndexes(): Promise<void> {
    const collection = this.collection();
    await collection.createIndex({ status: 1, published_at: -1 });
    await collection.createIndex({ status: 1, region: 1, category: 1, published_at: -1 });
    await collection.createIndex({ status: 1, video_type: 1, published_at: -1 });
    await collection.createIndex({ status: 1, 'metrics.sales': -1 });
    await collection.createIndex({ status: 1, 'metrics.revenue_usd': -1 });
    await collection.createIndex({ status: 1, 'metrics.views_count': -1 });
    await collection.createIndex({ status: 1, 'metrics.roas': -1 });
    await collection.createIndex(
      { owner_user_id: 1, status: 1, published_at: -1 },
      { sparse: true },
    );
    await collection.createIndex(
      { source_platform: 1, external_id: 1 },
      { unique: true, sparse: true },
    );
    await collection.createIndex({ owner_user_id: 1, source_platform: 1, source_url: 1 });
  }

  async list(
    input: ListHotVideosInput,
    locale: ContentLocale = 'en',
  ): Promise<ListHotVideosResult> {
    const parsed = ListHotVideosInputSchema.parse(input);
    const filter: Filter<HotVideoDocument> = { status: 'active' };
    const andFilters: Filter<HotVideoDocument>[] = [];

    if (parsed.ownerScope === 'me') {
      if (!parsed.ownerUserId) {
        return { items: [], total: 0 };
      }
      filter.owner_user_id = parsed.ownerUserId;
    } else if (parsed.ownerUserId) {
      andFilters.push({
        $or: [{ owner_user_id: parsed.ownerUserId }, { owner_user_id: { $exists: false } }],
      });
    } else {
      andFilters.push({
        $or: [{ owner_user_id: { $exists: false } }],
      });
    }

    if (parsed.region) filter.region = parsed.region;
    if (parsed.category) filter.category = parsed.category;
    if (parsed.videoType) filter.video_type = parsed.videoType;

    if (parsed.publishedRange !== 'all') {
      const days = parsed.publishedRange === '7d' ? 7 : 30;
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
      filter.published_at = { $gte: since };
    }

    if (parsed.gmvMin !== undefined && parsed.gmvMin > 0) {
      filter['metrics.revenue_usd'] = { $gte: parsed.gmvMin };
    }

    if (parsed.query) {
      const escaped = escapeRegExp(parsed.query);
      andFilters.push({
        $or: [
          { title: { $regex: escaped, $options: 'i' } },
          { product_name: { $regex: escaped, $options: 'i' } },
          { 'analysis.tags': { $regex: escaped, $options: 'i' } },
          { 'analysis.angle': { $regex: escaped, $options: 'i' } },
          { 'translations.en.title': { $regex: escaped, $options: 'i' } },
          { 'translations.en.productName': { $regex: escaped, $options: 'i' } },
          { 'translations.en.analysis.tags': { $regex: escaped, $options: 'i' } },
          { 'translations.en.analysis.angle': { $regex: escaped, $options: 'i' } },
          { 'translations.zh.title': { $regex: escaped, $options: 'i' } },
          { 'translations.zh.productName': { $regex: escaped, $options: 'i' } },
          { 'translations.zh.analysis.tags': { $regex: escaped, $options: 'i' } },
          { 'translations.zh.analysis.angle': { $regex: escaped, $options: 'i' } },
        ],
      });
    }

    if (andFilters.length > 0) filter.$and = andFilters;

    const sortField =
      parsed.ownerScope === 'me' && parsed.sort === 'publishedAt'
        ? 'created_at'
        : sortKeyToField(parsed.sort);
    const collection = this.collection();

    if (parsed.ownerScope === 'all' && parsed.ownerUserId) {
      const documents = await collection
        .aggregate<HotVideoDocument>(
          ownerRankedListPipeline({
            filter,
            ownerUserId: parsed.ownerUserId,
            sortField,
            skip: parsed.skip,
            limit: parsed.limit,
          }),
        )
        .toArray();
      const total = await collection.countDocuments(filter);

      return {
        items: documents.map((document) => toRecord(document, locale)),
        total,
      };
    }

    const [documents, total] = await Promise.all([
      collection
        .find(filter)
        .sort({ [sortField]: -1, _id: 1 })
        .skip(parsed.skip)
        .limit(parsed.limit)
        .toArray(),
      collection.countDocuments(filter),
    ]);

    return {
      items: documents.map((document) => toRecord(document, locale)),
      total,
    };
  }

  async getById(
    id: string,
    locale: ContentLocale = 'en',
    ownerUserId?: string | null,
  ): Promise<HotVideoRecord | null> {
    const document = await this.collection().findOne({
      _id: id,
      status: 'active',
      $or: ownerUserId
        ? [{ owner_user_id: ownerUserId }, { owner_user_id: { $exists: false } }]
        : [{ owner_user_id: { $exists: false } }],
    });
    return document ? toRecord(document, locale) : null;
  }

  async findByExternalId(
    sourcePlatform: HotVideoDocument['source_platform'],
    externalId: string,
  ): Promise<HotVideoRecord | null> {
    const document = await this.collection().findOne({
      source_platform: sourcePlatform,
      external_id: externalId,
    });
    return document ? toRecord(document, 'en') : null;
  }

  async findOwnedBySourceUrl(
    ownerUserId: string,
    sourcePlatform: HotVideoDocument['source_platform'],
    sourceUrl: string | undefined,
    locale: ContentLocale = 'en',
  ): Promise<HotVideoRecord | null> {
    const normalizedUrl = sourceUrl?.trim();
    if (!normalizedUrl) return null;

    const document = await this.collection().findOne({
      owner_user_id: ownerUserId,
      source_platform: sourcePlatform,
      source_url: normalizedUrl,
      status: 'active',
    });
    return document ? toRecord(document, locale) : null;
  }

  async create(input: CreateHotVideoInput): Promise<HotVideoRecord> {
    const parsed = CreateHotVideoInputSchema.parse(input);
    const now = new Date();
    const document = HotVideoDocumentSchema.parse({
      _id: randomUUID(),
      owner_user_id: parsed.ownerUserId,
      source_platform: parsed.sourcePlatform,
      source_url: parsed.sourceUrl,
      external_id: parsed.externalId,
      title: parsed.title,
      product_name: parsed.productName,
      author_handle: parsed.authorHandle,
      thumbnail_url: parsed.thumbnailUrl,
      preview_url: parsed.previewUrl,
      region: parsed.region,
      category: parsed.category,
      video_type: parsed.videoType,
      palette_css: parsed.paletteCss,
      accent_color: parsed.accentColor,
      metrics: {
        sales: parsed.metrics.sales,
        revenue_usd: parsed.metrics.revenueUsd,
        revenue_label: parsed.metrics.revenueLabel,
        views_count: parsed.metrics.viewsCount,
        views_label: parsed.metrics.viewsLabel,
        roas: parsed.metrics.roas,
      },
      analysis: parsed.analysis,
      translations: parsed.translations,
      published_at: parsed.publishedAt,
      ingested_at: now,
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
    return this.db.collection<HotVideoDocument>(COLLECTION);
  }
}

function sortKeyToField(sort: ListHotVideosInput['sort']): string {
  switch (sort) {
    case 'sales':
      return 'metrics.sales';
    case 'revenue':
      return 'metrics.revenue_usd';
    case 'views':
      return 'metrics.views_count';
    case 'roas':
      return 'metrics.roas';
    default:
      return 'published_at';
  }
}

function ownerRankedListPipeline(input: {
  filter: Filter<HotVideoDocument>;
  ownerUserId: string;
  sortField: string;
  skip: number;
  limit: number;
}): Document[] {
  const isOwnerExpression = { $eq: ['$owner_user_id', input.ownerUserId] };
  return [
    { $match: input.filter },
    {
      $addFields: {
        __owner_rank: { $cond: [isOwnerExpression, 0, 1] },
        __sort_value: {
          $cond: [
            { $and: [isOwnerExpression, { $eq: [input.sortField, 'published_at'] }] },
            '$created_at',
            `$${input.sortField}`,
          ],
        },
      },
    },
    { $sort: { __owner_rank: 1, __sort_value: -1, _id: 1 } },
    { $skip: input.skip },
    { $limit: input.limit },
    { $project: { __owner_rank: 0, __sort_value: 0 } },
  ];
}

function toRecord(document: HotVideoDocument, locale: ContentLocale): HotVideoRecord {
  const parsed = HotVideoDocumentSchema.parse(document);
  const translation = readTranslation(parsed.translations, locale);
  const analysis = translation.analysis ?? {};
  const metrics = translation.metrics ?? {};
  return HotVideoRecordSchema.parse({
    id: parsed._id,
    ownerUserId: parsed.owner_user_id,
    sourcePlatform: parsed.source_platform,
    sourceUrl: parsed.source_url,
    externalId: parsed.external_id,
    title: translation.title ?? parsed.title,
    productName: translation.productName ?? parsed.product_name,
    authorHandle: parsed.author_handle,
    thumbnailUrl: parsed.thumbnail_url,
    previewUrl: parsed.preview_url,
    region: translation.region ?? parsed.region,
    category: translation.category ?? parsed.category,
    videoType: translation.videoType ?? parsed.video_type,
    paletteCss: parsed.palette_css,
    accentColor: parsed.accent_color,
    metrics: {
      sales: parsed.metrics.sales,
      revenueUsd: parsed.metrics.revenue_usd,
      revenueLabel: metrics.revenueLabel ?? parsed.metrics.revenue_label,
      viewsCount: parsed.metrics.views_count,
      viewsLabel: metrics.viewsLabel ?? parsed.metrics.views_label,
      roas: parsed.metrics.roas,
    },
    analysis: {
      hook: analysis.hook ?? parsed.analysis.hook,
      angle: analysis.angle ?? parsed.analysis.angle,
      score: parsed.analysis.score,
      tags: analysis.tags ?? parsed.analysis.tags,
      structure: analysis.structure ?? parsed.analysis.structure,
    },
    publishedAt: parsed.published_at.toISOString(),
    status: parsed.status,
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
  });
}

function readTranslation(translations: HotVideoTranslations | undefined, locale: ContentLocale) {
  return translations?.[locale] ?? translations?.en ?? {};
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
