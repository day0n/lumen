import type { Collection, Db } from 'mongodb';

import {
  type HomeWorkflowTemplateCategoryRecord,
  HomeWorkflowTemplateCategoryRecordSchema,
  type HomeWorkflowTemplateCloneRecord,
  HomeWorkflowTemplateCloneRecordSchema,
  type HomeWorkflowTemplateDocument,
  HomeWorkflowTemplateDocumentSchema,
  type HomeWorkflowTemplateListRecord,
  HomeWorkflowTemplateListRecordSchema,
  type HomeWorkflowTemplateRecord,
  HomeWorkflowTemplateRecordSchema,
  type HomeWorkflowTemplateTranslations,
  type UpsertHomeWorkflowTemplateInput,
  UpsertHomeWorkflowTemplateInputSchema,
} from '../schema/homeWorkflowTemplate';

const COLLECTION = 'studio_home_workflow_templates';
type ContentLocale = 'en' | 'zh';
const HomeWorkflowTemplateSummaryDocumentSchema = HomeWorkflowTemplateDocumentSchema.omit({
  canvas: true,
  search_text: true,
}).passthrough();
type HomeWorkflowTemplateSummaryDocument = Omit<
  HomeWorkflowTemplateDocument,
  'canvas' | 'search_text'
>;

export class HomeWorkflowTemplateRepository {
  constructor(private readonly db: Db) {}

  async ensureIndexes(): Promise<void> {
    const collection = this.collection();
    await collection.createIndex({ status: 1, category_sort_order: 1, sort_order: 1 });
    await collection.createIndex({ status: 1, category_id: 1, sort_order: 1 });
    await collection.createIndex({ source_run_id: 1, result_node_id: 1 });
    await collection.createIndex({ search_text: 'text' });
  }

  async listActive({
    locale = 'en',
    perCategory = 9,
  }: {
    locale?: ContentLocale;
    perCategory?: number;
  } = {}): Promise<HomeWorkflowTemplateListRecord> {
    const limitPerCategory = Math.max(1, Math.min(24, perCategory));
    const documents = await this.collection()
      .find(
        { status: 'active' },
        {
          projection: {
            canvas: 0,
            search_text: 0,
          },
        },
      )
      .sort({ category_sort_order: 1, sort_order: 1, _id: 1 })
      .limit(160)
      .toArray();

    const categories = new Map<string, HomeWorkflowTemplateCategoryRecord>();
    const categoryCounts = new Map<string, number>();
    const items: HomeWorkflowTemplateRecord[] = [];

    for (const document of documents) {
      const record = toRecord(document as HomeWorkflowTemplateSummaryDocument, locale);
      const currentCount = categoryCounts.get(record.categoryId) ?? 0;
      categoryCounts.set(record.categoryId, currentCount + 1);

      if (!categories.has(record.categoryId)) {
        categories.set(
          record.categoryId,
          HomeWorkflowTemplateCategoryRecordSchema.parse({
            id: record.categoryId,
            label: record.categoryLabel,
            sortOrder: record.categorySortOrder,
            count: 0,
          }),
        );
      }

      if (currentCount < limitPerCategory) {
        items.push(record);
      }
    }

    const categoryRecords = [...categories.values()].map((category) =>
      HomeWorkflowTemplateCategoryRecordSchema.parse({
        ...category,
        count: categoryCounts.get(category.id) ?? 0,
      }),
    );

    return HomeWorkflowTemplateListRecordSchema.parse({
      categories: categoryRecords,
      items,
    });
  }

  async getActive(
    templateId: string,
    locale: ContentLocale = 'en',
  ): Promise<HomeWorkflowTemplateCloneRecord | null> {
    const document = await this.collection().findOne({
      _id: templateId,
      status: 'active',
    });
    if (!document) return null;
    return toCloneRecord(document, locale);
  }

  async incrementUsage(templateId: string): Promise<void> {
    await this.collection().updateOne(
      { _id: templateId },
      {
        $inc: { usage_count: 1 },
        $set: { updated_at: new Date() },
      },
    );
  }

  async upsertMany(inputs: UpsertHomeWorkflowTemplateInput[]): Promise<number> {
    if (inputs.length === 0) return 0;
    const now = new Date();
    const operations = inputs.map((input) => {
      const parsed = UpsertHomeWorkflowTemplateInputSchema.parse(input);
      return {
        updateOne: {
          filter: { _id: parsed._id },
          update: {
            $set: {
              ...parsed,
              updated_at: now,
            },
            $setOnInsert: {
              created_at: now,
            },
          },
          upsert: true,
        },
      };
    });

    const result = await this.collection().bulkWrite(operations, { ordered: false });
    return result.upsertedCount + result.modifiedCount;
  }

  async hideMissing(activeIds: string[]): Promise<number> {
    const result = await this.collection().updateMany(
      { _id: { $nin: activeIds }, status: 'active' },
      {
        $set: {
          status: 'hidden',
          updated_at: new Date(),
        },
      },
    );
    return result.modifiedCount;
  }

  private collection(): Collection<HomeWorkflowTemplateDocument> {
    return this.db.collection<HomeWorkflowTemplateDocument>(COLLECTION);
  }
}

function toRecord(
  document: HomeWorkflowTemplateSummaryDocument,
  locale: ContentLocale,
): HomeWorkflowTemplateRecord {
  const parsed = HomeWorkflowTemplateSummaryDocumentSchema.parse(document);
  const translation = readTranslation(parsed.translations, locale);
  return HomeWorkflowTemplateRecordSchema.parse({
    id: parsed._id,
    categoryId: parsed.category_id,
    categoryLabel: translation.categoryLabel ?? parsed.category_label,
    categorySortOrder: parsed.category_sort_order,
    title: translation.title ?? parsed.title,
    subtitle: translation.subtitle ?? parsed.subtitle,
    description: translation.description ?? parsed.description,
    badge: translation.badge ?? parsed.badge,
    tags: parsed.tags,
    coverUrl: parsed.cover_url,
    mediaType: parsed.media_type,
    sourceProjectId: parsed.source_project_id,
    sourceRunId: parsed.source_run_id,
    resultNodeId: parsed.result_node_id,
    resultUrl: parsed.result_url,
    lastRunAt: parsed.last_run_at.toISOString(),
    usageCount: parsed.usage_count,
    sortOrder: parsed.sort_order,
    status: parsed.status,
    createdAt: parsed.created_at.toISOString(),
    updatedAt: parsed.updated_at.toISOString(),
  });
}

function toCloneRecord(
  document: HomeWorkflowTemplateDocument,
  locale: ContentLocale,
): HomeWorkflowTemplateCloneRecord {
  const record = toRecord(document, locale);
  const parsed = HomeWorkflowTemplateDocumentSchema.parse(document);
  return HomeWorkflowTemplateCloneRecordSchema.parse({
    ...record,
    canvas: parsed.canvas,
  });
}

function readTranslation(
  translations: HomeWorkflowTemplateTranslations | undefined,
  locale: ContentLocale,
) {
  return translations?.[locale] ?? translations?.en ?? {};
}
