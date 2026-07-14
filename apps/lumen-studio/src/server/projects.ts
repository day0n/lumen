import 'server-only';

import type {
  ProjectCanvas,
  ProjectHistoryRecord,
  ProjectHistorySummaryRecord,
  ProjectListRecord,
  ProjectRecord,
  UpdateProjectInput,
} from '@lumen/db';
import { projectDetailCacheKey } from '@lumen/shared/project-cache';

import { translate } from '@/i18n/messages';
import { DEFAULT_LOCALE, type Locale } from '@/i18n/routing';
import { requireStudioUser } from './auth';
import { getProjectHistoryRepository, getProjectRepository, getStudioCache } from './db';
import { ensureProjectShareWithCacheInvalidation } from './project-cache-mutations';
import {
  getStudioProjectDetailQueries,
  getStudioProjectQueries,
  getStudioProjectShares,
} from './project-query-runtime';
import { traceStudioStep } from './telemetry';
import { reconcileCanvasWithWorkflowResults } from './workflow-canvas-reconcile';

const PROJECT_CACHE_TTL_SECONDS = 30;

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
  /** 未显式传 title 时，按此语言生成默认项目名，保证默认命名跟随 UI 语言。 */
  locale?: Locale;
}

export async function listStudioProjects(
  options: ListStudioProjectsOptions = {},
): Promise<ProjectListRecord[]> {
  const user = await traceStudioStep('studio.auth.require_user', 'auth', () => requireStudioUser());
  return getStudioProjectQueries().listProjects(user.id, options);
}

export async function createStudioProject(
  options: CreateStudioProjectOptions = {},
): Promise<ProjectRecord> {
  const user = await requireStudioUser();
  const repository = await getProjectRepository();
  const cache = getStudioCache();

  const project = await repository.create({
    ownerId: user.id,
    title: options.title ?? translate(options.locale ?? DEFAULT_LOCALE, 'canvas.untitled'),
    description: options.description,
    thumbnail: options.thumbnail,
    folderId: options.folderId,
    canvas: options.canvas,
  });

  await cache.set(projectDetailCacheKey(user.id, project.id), project, PROJECT_CACHE_TTL_SECONDS);
  await clearProjectListCache(user.id);
  await recordProjectHistory({
    action: 'created',
    ownerId: user.id,
    project,
  });
  return project;
}

export async function getStudioProject(
  projectId: string,
  options: { bypassCache?: boolean } = {},
): Promise<ProjectRecord | null> {
  const user = await requireStudioUser();
  return getStudioProjectDetailQueries().getProject(user.id, projectId, options);
}

export async function updateStudioProject(
  projectId: string,
  input: UpdateProjectInput,
): Promise<ProjectRecord | null> {
  const user = await requireStudioUser();
  const repository = await getProjectRepository();
  const cache = getStudioCache();

  let nextInput = input;
  if (input.canvas !== undefined) {
    const exists = await repository.exists(user.id, projectId);
    if (!exists) {
      await cache.delete(projectDetailCacheKey(user.id, projectId));
      return null;
    }
    nextInput = {
      ...input,
      canvas: await reconcileCanvasWithWorkflowResults(projectId, input.canvas),
    };
  }

  const project = await repository.update(user.id, projectId, nextInput);
  const cacheKey = projectDetailCacheKey(user.id, projectId);

  if (project) await cache.set(cacheKey, project, PROJECT_CACHE_TTL_SECONDS);
  else await cache.delete(cacheKey);

  if (project) await clearProjectListCache(user.id);

  if (project && nextInput.canvas !== undefined) {
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
  const result = await ensureProjectShareWithCacheInvalidation({
    actorUserId: user.id,
    cache: getStudioProjectQueries(),
    projectId,
    repository,
  });
  if (!result) {
    throw new Error('项目不存在');
  }
  return result;
}

export async function getSharedProjectPreview(shareId: string): Promise<ProjectRecord | null> {
  const repository = await getProjectRepository();
  return repository.getByShareId(shareId);
}

export async function cloneSharedProject(shareId: string): Promise<ProjectRecord | null> {
  const user = await requireStudioUser();
  const clone = await getStudioProjectShares().cloneForOwner(user.id, shareId);
  if (!clone) return null;
  return getStudioProjectDetailQueries().getProject(user.id, clone.projectId, {
    bypassCache: true,
  });
}

export async function deleteStudioProject(projectId: string): Promise<boolean> {
  const user = await requireStudioUser();
  const repository = await getProjectRepository();
  const deleted = await repository.delete(user.id, projectId);

  if (deleted) {
    const cache = getStudioCache();
    await cache.delete(projectDetailCacheKey(user.id, projectId));
    await clearProjectListCache(user.id);
  }

  return deleted;
}

async function clearProjectListCache(ownerId: string) {
  await getStudioProjectQueries().invalidateProjectLists(ownerId);
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
