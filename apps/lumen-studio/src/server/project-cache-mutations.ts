import type { ProjectCacheInvalidator } from '@lumen/shared/project-cache';

interface ProjectShareRepository<TProject> {
  ensureShareId(
    actorUserId: string,
    projectId: string,
  ): Promise<{ shareId: string; created: boolean } | null>;
  get(actorUserId: string, projectId: string): Promise<TProject | null>;
}

interface FolderProjectRepository {
  clearFolderForOwner(
    actorUserId: string,
    folderId: string,
  ): Promise<{ matchedCount: number; projectIds: string[] }>;
  deleteAllInFolder(
    actorUserId: string,
    folderId: string,
  ): Promise<{ matchedCount: number; projectIds: string[] }>;
}

export async function ensureProjectShareWithCacheInvalidation<TProject>(options: {
  actorUserId: string;
  cache: ProjectCacheInvalidator;
  projectId: string;
  repository: ProjectShareRepository<TProject>;
}): Promise<{ shareId: string; project: TProject } | null> {
  const ensured = await options.repository.ensureShareId(options.actorUserId, options.projectId);
  if (!ensured) return null;

  if (ensured.created) {
    await options.cache.invalidateProject(options.actorUserId, options.projectId);
  }

  const project = await options.repository.get(options.actorUserId, options.projectId);
  return project ? { shareId: ensured.shareId, project } : null;
}

export async function clearRetiredProjectFoldersWithCacheInvalidation(options: {
  actorUserId: string;
  cache: ProjectCacheInvalidator;
  folderIds: readonly string[];
  repository: FolderProjectRepository;
}): Promise<number> {
  const results = await Promise.allSettled(
    options.folderIds.map(async (folderId) => {
      const result = await options.repository.clearFolderForOwner(options.actorUserId, folderId);
      if (result.matchedCount > 0) {
        await options.cache.invalidateProjects(options.actorUserId, result.projectIds);
      }
      return result.matchedCount;
    }),
  );

  for (const result of results) {
    if (result.status === 'rejected') throw result.reason;
  }

  return results.reduce(
    (total, result) => total + (result.status === 'fulfilled' ? result.value : 0),
    0,
  );
}

export async function deleteFolderWithProjectCacheInvalidation(options: {
  actorUserId: string;
  cache: ProjectCacheInvalidator;
  deleteFolder: () => Promise<boolean>;
  folderId: string;
  invalidateFolderList: () => Promise<void>;
  repository: FolderProjectRepository;
}): Promise<boolean> {
  const result = await options.repository.deleteAllInFolder(options.actorUserId, options.folderId);
  if (result.matchedCount > 0) {
    await options.cache.invalidateProjects(options.actorUserId, result.projectIds);
  }

  let deleted: boolean;
  try {
    deleted = await options.deleteFolder();
  } catch (error) {
    try {
      await options.invalidateFolderList();
    } catch {}
    throw error;
  }

  await options.invalidateFolderList();
  return deleted;
}
