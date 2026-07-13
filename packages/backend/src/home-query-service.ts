export type HomeLocale = 'en' | 'zh';

export interface ParseSchema<T> {
  parse(value: unknown): T;
}

export interface JsonCachePort {
  get<T>(key: string, schema: ParseSchema<T>): Promise<T | null>;
  set(key: string, value: unknown, ttlSeconds: number): Promise<void>;
  delete(key: string): Promise<void>;
  deleteMany?(keys: readonly string[]): Promise<void>;
}

export interface HomeFeaturedRepositoryPort<TItem> {
  listActive(limit: number, locale: HomeLocale): Promise<TItem[]>;
}

export interface HomeTemplateRepositoryPort<TList> {
  listActive(options: { locale: HomeLocale; perCategory: number }): Promise<TList>;
}

export type TraceStep = <T>(
  name: string,
  operation: string,
  callback: () => T | Promise<T>,
  attributes?: Record<string, string | number | boolean>,
) => Promise<T>;

export interface HomeQueryService<TFeaturedItem, TTemplateList> {
  listFeatured(locale?: HomeLocale): Promise<TFeaturedItem[]>;
  listTemplates(locale?: HomeLocale): Promise<TTemplateList>;
  invalidateFeatured(): Promise<void>;
  invalidateTemplates(): Promise<void>;
}

export interface CreateHomeQueryServiceOptions<TFeaturedItem, TTemplateList> {
  cache: JsonCachePort;
  featuredListSchema: ParseSchema<TFeaturedItem[]>;
  templateListSchema: ParseSchema<TTemplateList>;
  getFeaturedRepository: () => Promise<HomeFeaturedRepositoryPort<TFeaturedItem>>;
  getTemplateRepository: () => Promise<HomeTemplateRepositoryPort<TTemplateList>>;
  trace?: TraceStep;
  tracePrefix: string;
}

const CACHE_TTL_SECONDS = 300;
const FEATURED_CACHE_KEY_PREFIX = 'home:featured:v2';
const TEMPLATE_CACHE_KEY_PREFIX = 'home:workflow-templates:v1';
const FEATURED_LIMIT = 12;
const TEMPLATES_PER_CATEGORY = 9;

export function createHomeQueryService<TFeaturedItem, TTemplateList>(
  options: CreateHomeQueryServiceOptions<TFeaturedItem, TTemplateList>,
): HomeQueryService<TFeaturedItem, TTemplateList> {
  const trace: TraceStep = options.trace ?? (async (_name, _operation, callback) => callback());

  return {
    async listFeatured(locale = 'en') {
      const cacheKey = `${FEATURED_CACHE_KEY_PREFIX}:${locale}`;
      const cached = await trace(
        `${options.tracePrefix}.home.featured.cache_get`,
        'cache.get',
        () => options.cache.get(cacheKey, options.featuredListSchema),
      );
      if (cached) return cached;

      const repository = await trace(
        `${options.tracePrefix}.home.featured.repository`,
        'db.connect',
        options.getFeaturedRepository,
      );
      const items = await trace(`${options.tracePrefix}.home.featured.db`, 'db.query', () =>
        repository.listActive(FEATURED_LIMIT, locale),
      );
      await trace(`${options.tracePrefix}.home.featured.cache_set`, 'cache.set', () =>
        options.cache.set(cacheKey, items, CACHE_TTL_SECONDS),
      );
      return items;
    },

    async listTemplates(locale = 'en') {
      const cacheKey = `${TEMPLATE_CACHE_KEY_PREFIX}:${locale}`;
      const cached = await trace(
        `${options.tracePrefix}.home.templates.cache_get`,
        'cache.get',
        () => options.cache.get(cacheKey, options.templateListSchema),
      );
      if (cached) return cached;

      const repository = await trace(
        `${options.tracePrefix}.home.templates.repository`,
        'db.connect',
        options.getTemplateRepository,
      );
      const templates = await trace(`${options.tracePrefix}.home.templates.db`, 'db.query', () =>
        repository.listActive({ locale, perCategory: TEMPLATES_PER_CATEGORY }),
      );
      await trace(`${options.tracePrefix}.home.templates.cache_set`, 'cache.set', () =>
        options.cache.set(cacheKey, templates, CACHE_TTL_SECONDS),
      );
      return templates;
    },

    async invalidateFeatured() {
      await Promise.all([
        options.cache.delete(`${FEATURED_CACHE_KEY_PREFIX}:en`),
        options.cache.delete(`${FEATURED_CACHE_KEY_PREFIX}:zh`),
      ]);
    },

    async invalidateTemplates() {
      await Promise.all([
        options.cache.delete(`${TEMPLATE_CACHE_KEY_PREFIX}:en`),
        options.cache.delete(`${TEMPLATE_CACHE_KEY_PREFIX}:zh`),
      ]);
    },
  };
}
