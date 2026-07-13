import type { JsonCachePort, ParseSchema, TraceStep } from './home-query-service.js';

export interface ProjectListOptions {
  query?: string;
  limit?: number;
  /** A folder id filters that folder; `uncategorized` filters projects without a folder. */
  folderId?: string | 'uncategorized';
}

export interface ProjectListRepositoryPort<TProject> {
  list(input: {
    ownerId: string;
    query?: string;
    limit: number;
    folderId?: string | 'uncategorized';
  }): Promise<TProject[]>;
}

export interface ProjectQueryService<TProject> {
  listProjects(actorUserId: string, options?: ProjectListOptions): Promise<TProject[]>;
  invalidateProjectLists(actorUserId: string): Promise<void>;
}

export interface CreateProjectQueryServiceOptions<TProject> {
  cache: JsonCachePort;
  getRepository: () =>
    | ProjectListRepositoryPort<TProject>
    | Promise<ProjectListRepositoryPort<TProject>>;
  projectListSchema: ParseSchema<TProject[]>;
  trace?: TraceStep;
  tracePrefix: string;
}

const PROJECT_LIST_CACHE_TTL_SECONDS = 30;
const CACHED_PROJECT_LIST_LIMITS = new Set([3, 50]);

export function createProjectQueryService<TProject>(
  options: CreateProjectQueryServiceOptions<TProject>,
): ProjectQueryService<TProject> {
  const trace: TraceStep = options.trace ?? (async (_name, _operation, callback) => callback());

  return {
    async listProjects(actorUserId, listOptions = {}) {
      assertActorUserId(actorUserId);
      const limit = listOptions.limit ?? 50;
      const query = normalizeProjectListQuery(listOptions.query);
      const folderId = listOptions.folderId;
      const cacheKey = projectListCacheKey(actorUserId, { query, limit, folderId });
      const canUseCache = shouldUseProjectListCache({ query, limit, folderId });
      const cached = canUseCache
        ? await trace(
            `${options.tracePrefix}.projects.list.cache_get`,
            'cache.get',
            () => options.cache.get(cacheKey, options.projectListSchema),
            { limit },
          )
        : null;

      if (cached) return cached;

      const repository = await trace(
        `${options.tracePrefix}.projects.repository`,
        'db.connect',
        options.getRepository,
      );
      const projects = await trace(
        `${options.tracePrefix}.projects.list.db`,
        'db.query',
        () =>
          repository.list({
            ownerId: actorUserId,
            query,
            limit,
            ...(folderId !== undefined ? { folderId } : {}),
          }),
        { limit, has_query: Boolean(query) },
      );

      if (canUseCache) {
        await trace(
          `${options.tracePrefix}.projects.list.cache_set`,
          'cache.set',
          () => options.cache.set(cacheKey, projects, PROJECT_LIST_CACHE_TTL_SECONDS),
          { limit, result_count: projects.length },
        );
      }

      return projects;
    },

    async invalidateProjectLists(actorUserId) {
      assertActorUserId(actorUserId);
      await Promise.all(
        [...CACHED_PROJECT_LIST_LIMITS].map((limit) =>
          options.cache.delete(projectListCacheKey(actorUserId, { limit })),
        ),
      );
    },
  };
}

export function parseProjectListSearchParams(
  searchParams: Pick<URLSearchParams, 'get'>,
): ProjectListOptions {
  const query = searchParams.get('q') ?? undefined;
  const limitParam = searchParams.get('limit');
  const limit = limitParam ? Number.parseInt(limitParam, 10) : undefined;
  const folderIdParam = searchParams.get('folderId');
  const folderId =
    folderIdParam === 'uncategorized'
      ? 'uncategorized'
      : folderIdParam && folderIdParam.trim().length > 0
        ? folderIdParam
        : undefined;

  return { query, limit, folderId };
}

function projectListCacheKey(
  actorUserId: string,
  options: {
    query?: string;
    limit: number;
    folderId?: string;
  },
) {
  return `projects:${actorUserId}:list:limit:${options.limit}:f:${encodeURIComponent(
    options.folderId ?? '',
  )}:q:${encodeURIComponent(options.query ?? '')}`;
}

function normalizeProjectListQuery(query?: string) {
  const normalized = query?.trim();
  return normalized ? normalized : undefined;
}

function shouldUseProjectListCache({
  query,
  limit,
  folderId,
}: {
  query?: string;
  limit: number;
  folderId?: string;
}) {
  return !query && !folderId && CACHED_PROJECT_LIST_LIMITS.has(limit);
}

function assertActorUserId(actorUserId: string): void {
  if (!actorUserId.trim()) {
    throw new Error('actorUserId is required');
  }
}
