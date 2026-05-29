import 'server-only';

import {
  type ProjectCanvas,
  type ProjectHistoryRecord,
  type ProjectRecord,
  ProjectRecordSchema,
  type UpdateProjectInput,
} from '@lumen/db';

import { requireStudioUser } from './auth';
import { getProjectHistoryRepository, getProjectRepository, getStudioCache } from './db';

const PROJECT_CACHE_TTL_SECONDS = 30;

export interface ListStudioProjectsOptions {
  query?: string;
  limit?: number;
}

export interface CreateStudioProjectOptions {
  title?: string;
  description?: string;
  thumbnail?: string;
  canvas?: ProjectCanvas;
}

export async function listStudioProjects(
  options: ListStudioProjectsOptions = {},
): Promise<ProjectRecord[]> {
  const user = await requireStudioUser();
  const repository = await getProjectRepository();

  return repository.list({
    ownerId: user.id,
    query: options.query,
    limit: options.limit ?? 50,
  });
}

export async function createStudioProject(
  options: CreateStudioProjectOptions = {},
): Promise<ProjectRecord> {
  const user = await requireStudioUser();
  const repository = await getProjectRepository();
  const cache = getStudioCache();

  const project = await repository.create({
    ownerId: user.id,
    title: options.title ?? '未命名画布',
    description: options.description,
    thumbnail: options.thumbnail,
    canvas: options.canvas,
  });

  await cache.set(projectCacheKey(user.id, project.id), project, PROJECT_CACHE_TTL_SECONDS);
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

  if (project && input.canvas !== undefined) {
    await recordProjectHistory({
      action: 'updated',
      ownerId: user.id,
      project,
    });
  }

  return project;
}

export async function listStudioProjectHistory(projectId: string): Promise<ProjectHistoryRecord[]> {
  const user = await requireStudioUser();
  const project = await getStudioProject(projectId);
  if (!project) return [];

  const repository = await getProjectHistoryRepository();
  return repository.listLatest({
    ownerId: user.id,
    projectId,
    limit: 3,
  });
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
    await getStudioCache().delete(projectCacheKey(user.id, projectId));
  }

  return deleted;
}

function projectCacheKey(ownerId: string, projectId: string) {
  return `project:${ownerId}:${projectId}`;
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
