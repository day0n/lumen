import { randomUUID } from 'node:crypto';

import type { Db, Filter } from 'mongodb';

import {
  type CreateHotVideoInput,
  CreateHotVideoInputSchema,
  type HotVideoDocument,
  HotVideoDocumentSchema,
  type HotVideoRecord,
  HotVideoRecordSchema,
  type ListHotVideosInput,
  ListHotVideosInputSchema,
} from '../schema/hotVideos';

const COLLECTION = 'studio_hot_videos';

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
  }

  async list(input: ListHotVideosInput): Promise<ListHotVideosResult> {
    const parsed = ListHotVideosInputSchema.parse(input);
    const filter: Filter<HotVideoDocument> = { status: 'active' };

    if (parsed.ownerScope === 'me') {
      if (!parsed.ownerUserId) {
        return { items: [], total: 0 };
      }
      filter.owner_user_id = parsed.ownerUserId;
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
      filter.$or = [
        { title: { $regex: escaped, $options: 'i' } },
        { product_name: { $regex: escaped, $options: 'i' } },
        { 'analysis.tags': { $regex: escaped, $options: 'i' } },
        { 'analysis.angle': { $regex: escaped, $options: 'i' } },
      ];
    }

    const sortField = sortKeyToField(parsed.sort);
    const collection = this.collection();

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
      items: documents.map(toRecord),
      total,
    };
  }

  async getById(id: string): Promise<HotVideoRecord | null> {
    const document = await this.collection().findOne({ _id: id, status: 'active' });
    return document ? toRecord(document) : null;
  }

  async findByExternalId(
    sourcePlatform: HotVideoDocument['source_platform'],
    externalId: string,
  ): Promise<HotVideoRecord | null> {
    const document = await this.collection().findOne({
      source_platform: sourcePlatform,
      external_id: externalId,
    });
    return document ? toRecord(document) : null;
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
      published_at: parsed.publishedAt,
      ingested_at: now,
      status: parsed.status ?? 'active',
      created_at: now,
      updated_at: now,
    });

    await this.collection().insertOne(document);
    return toRecord(document);
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

function toRecord(document: HotVideoDocument): HotVideoRecord {
  const parsed = HotVideoDocumentSchema.parse(document);
  return HotVideoRecordSchema.parse({
    id: parsed._id,
    ownerUserId: parsed.owner_user_id,
    sourcePlatform: parsed.source_platform,
    sourceUrl: parsed.source_url,
    externalId: parsed.external_id,
    title: parsed.title,
    productName: parsed.product_name,
    authorHandle: parsed.author_handle,
    thumbnailUrl: parsed.thumbnail_url,
    previewUrl: parsed.preview_url,
    region: parsed.region,
    category: parsed.category,
    videoType: parsed.video_type,
    paletteCss: parsed.palette_css,
    accentColor: parsed.accent_color,
    metrics: {
      sales: parsed.metrics.sales,
      revenueUsd: parsed.metrics.revenue_usd,
      revenueLabel: parsed.metrics.revenue_label,
      viewsCount: parsed.metrics.views_count,
      viewsLabel: parsed.metrics.views_label,
      roas: parsed.metrics.roas,
    },
    analysis: parsed.analysis,
    publishedAt: parsed.published_at.toISOString(),
    status: parsed.status,
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
  });
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
