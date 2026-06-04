import 'server-only';

import {
  type ProjectCanvas,
  type ProjectHistoryRecord,
  type ProjectHistorySummaryRecord,
  type ProjectListRecord,
  ProjectListRecordSchema,
  type ProjectRecord,
  ProjectRecordSchema,
  type UpdateProjectInput,
} from '@lumen/db';

import { requireStudioUser } from './auth';
import { getProjectHistoryRepository, getProjectRepository, getStudioCache } from './db';
import { traceStudioStep } from './telemetry';

const PROJECT_CACHE_TTL_SECONDS = 30;
const PROJECT_LIST_CACHE_TTL_SECONDS = 30;
const CACHED_PROJECT_LIST_LIMITS = new Set([3, 50]);

export interface ListStudioProjectsOptions {
  query?: string;
  limit?: number;
  /** 字符串 = 该文件夹下；`'uncategorized'` = 未分类；不传 = 全部。 */
  folderId?: string | 'uncategorized';
}

export interface CreateStudioProjectOptions {
  title?: string;
  description?: string;
  thumbnail?: string;
  folderId?: string;
  canvas?: ProjectCanvas;
}

export async function listStudioProjects(
  options: ListStudioProjectsOptions = {},
): Promise<ProjectListRecord[]> {
  const user = await traceStudioStep('studio.auth.require_user', 'auth', () => requireStudioUser());
  const limit = options.limit ?? 50;
  const query = normalizeProjectListQuery(options.query);
  const folderId = options.folderId;
  const cache = getStudioCache();
  const cacheKey = projectListCacheKey(user.id, { query, limit, folderId });
  const canUseCache = shouldUseProjectListCache({ query, limit, folderId });
  const cached = canUseCache
    ? await traceStudioStep(
        'studio.projects.list.cache_get',
        'cache.get',
        () => cache.get(cacheKey, ProjectListRecordSchema.array()),
        { limit },
      )
    : null;

  if (cached) return cached;

  const repository = await getProjectRepository();
  const projects = await traceStudioStep(
    'studio.projects.list.db',
    'db.query',
    () =>
      repository.list({
        ownerId: user.id,
        query,
        limit,
        ...(folderId !== undefined ? { folderId } : {}),
      }),
    { limit, has_query: Boolean(query) },
  );

  if (canUseCache) {
    await traceStudioStep(
      'studio.projects.list.cache_set',
      'cache.set',
      () => cache.set(cacheKey, projects, PROJECT_LIST_CACHE_TTL_SECONDS),
      { limit, result_count: projects.length },
    );
  }

  return projects;
}

export async function createStudioProject(
  options: CreateStudioProjectOptions = {},
): Promise<ProjectRecord> {
  const user = await requireStudioUser();
  const repository = await getProjectRepository();
  const cache = getStudioCache();

  const project = await repository.create({
    ownerId: user.id,
    title: options.title ?? 'Untitled canvas',
    description: options.description,
    thumbnail: options.thumbnail,
    folderId: options.folderId,
    canvas: options.canvas,
  });

  await cache.set(projectCacheKey(user.id, project.id), project, PROJECT_CACHE_TTL_SECONDS);
  await clearProjectListCache(user.id);
  await recordProjectHistory({
    action: 'created',
    ownerId: user.id,
    project,
  });
  return project;
}

export async function getStudioProject(projectId: string): Promise<ProjectRecord | null> {
  const user = await requireStudioUser();
  const cache = getStudioCache();
  const cacheKey = projectCacheKey(user.id, projectId);
  const cached = await cache.get(cacheKey, ProjectRecordSchema);

  if (cached) return cached;

  const repository = await getProjectRepository();
  const project = await repository.get(user.id, projectId);
  if (project) await cache.set(cacheKey, project, PROJECT_CACHE_TTL_SECONDS);
  return project;
}

export async function updateStudioProject(
  projectId: string,
  input: UpdateProjectInput,
): Promise<ProjectRecord | null> {
  const user = await requireStudioUser();
  const repository = await getProjectRepository();
  const cache = getStudioCache();

  const project = await repository.update(user.id, projectId, input);
  const cacheKey = projectCacheKey(user.id, projectId);

  if (project) await cache.set(cacheKey, project, PROJECT_CACHE_TTL_SECONDS);
  else await cache.delete(cacheKey);

  if (project) await clearProjectListCache(user.id);

  if (project && input.canvas !== undefined) {
    await recordProjectHistory({
      action: 'updated',
      ownerId: user.id,
      project,
    });
  }

  return project;
}

export async function listStudioProjectHistory(
  projectId: string,
): Promise<ProjectHistorySummaryRecord[]> {
  const user = await traceStudioStep('studio.auth.require_user', 'auth', () => requireStudioUser());
  const repository = await getProjectHistoryRepository();
  return traceStudioStep(
    'studio.projects.history.list.db',
    'db.query',
    () =>
      repository.listLatestSummaries({
        ownerId: user.id,
        projectId,
        limit: 3,
      }),
    { project_id: projectId, limit: 3 },
  );
}

export async function getStudioProjectHistoryRecord(
  projectId: string,
  historyId: string,
): Promise<ProjectHistoryRecord | null> {
  const user = await requireStudioUser();
  const repository = await getProjectHistoryRepository();
  return repository.get(user.id, projectId, historyId);
}

export async function createProjectShare(projectId: string): Promise<{
  shareId: string;
  project: ProjectRecord;
}> {
  const user = await requireStudioUser();
  const repository = await getProjectRepository();
  const shareId = await repository.ensureShareId(user.id, projectId);

  if (!shareId) {
    throw new Error('项目不存在');
  }

  const project = await repository.get(user.id, projectId);
  if (!project) {
    throw new Error('项目不存在');
  }

  await getStudioCache().delete(projectCacheKey(user.id, projectId));
  return { shareId, project };
}

export async function getSharedProjectPreview(shareId: string): Promise<ProjectRecord | null> {
  const repository = await getProjectRepository();
  return repository.getByShareId(shareId);
}

export async function cloneSharedProject(shareId: string): Promise<ProjectRecord | null> {
  const user = await requireStudioUser();
  const repository = await getProjectRepository();
  const source = await repository.getByShareId(shareId);
  if (!source) return null;

  if (source.ownerId === user.id) {
    return source;
  }

  const project = await repository.create({
    ownerId: user.id,
    title: source.title,
    description: source.description,
    thumbnail: source.thumbnail,
    canvas: source.canvas,
  });

  await getStudioCache().set(
    projectCacheKey(user.id, project.id),
    project,
    PROJECT_CACHE_TTL_SECONDS,
  );
  await clearProjectListCache(user.id);
  await recordProjectHistory({
    action: 'created',
    ownerId: user.id,
    project,
  });
  return project;
}

export async function deleteStudioProject(projectId: string): Promise<boolean> {
  const user = await requireStudioUser();
  const repository = await getProjectRepository();
  const deleted = await repository.delete(user.id, projectId);

  if (deleted) {
    const cache = getStudioCache();
    await cache.delete(projectCacheKey(user.id, projectId));
    await clearProjectListCache(user.id);
  }

  return deleted;
}

function projectCacheKey(ownerId: string, projectId: string) {
  return `project:${ownerId}:${projectId}`;
}

function projectListCacheKey(
  ownerId: string,
  options: {
    query?: string;
    limit: number;
    folderId?: string;
  },
) {
  return `${projectListCachePrefix(ownerId)}limit:${options.limit}:f:${encodeURIComponent(
    options.folderId ?? '',
  )}:q:${encodeURIComponent(options.query ?? '')}`;
}

function projectListCachePrefix(ownerId: string) {
  return `projects:${ownerId}:list:`;
}

async function clearProjectListCache(ownerId: string) {
  // 只清不带 query 的缓存键（哪些 limit/folderId 组合会进缓存由 shouldUseProjectListCache 决定）。
  // folderId === undefined 对应"全部"列表，其他视图改动时把它一并失效。
  await Promise.all(
    [...CACHED_PROJECT_LIST_LIMITS].map((limit) =>
      getStudioCache().delete(projectListCacheKey(ownerId, { limit })),
    ),
  );
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
  // 只对"无搜索 + 全部范围"的请求走缓存，避免按文件夹过滤的键膨胀。
  return !query && !folderId && CACHED_PROJECT_LIST_LIMITS.has(limit);
}

async function recordProjectHistory({
  action,
  ownerId,
  project,
}: {
  action: 'created' | 'updated' | 'restored';
  ownerId: string;
  project: ProjectRecord;
}) {
  const repository = await getProjectHistoryRepository();
  await repository.recordSnapshot({
    action,
    ownerId,
    projectId: project.id,
    title: project.title,
    canvas: project.canvas,
  });
}
