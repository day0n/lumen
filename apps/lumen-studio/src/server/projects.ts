import 'server-only';

import {
  type ProjectCanvas,
  type ProjectRecord,
  ProjectRecordSchema,
  type UpdateProjectInput,
} from '@lumen/db';

import { requireStudioUser } from './auth';
import { getProjectRepository, getStudioCache } from './db';

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
