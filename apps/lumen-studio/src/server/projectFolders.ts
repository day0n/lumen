import 'server-only';

import type { ProjectFolderRecord, UpdateProjectFolderInput } from '@lumen/db';
import { ProjectFolderRecordSchema } from '@lumen/db';
import { z } from 'zod';

import { requireStudioUser } from './auth';
import { getProjectFolderRepository, getProjectRepository, getStudioCache } from './db';
import {
  clearRetiredProjectFoldersWithCacheInvalidation,
  deleteFolderWithProjectCacheInvalidation,
} from './project-cache-mutations';
import { getStudioProjectQueries } from './project-query-runtime';

const FOLDER_LIST_CACHE_TTL_SECONDS = 30;
const FolderListWithCountsSchema = z
  .object({
    folders: z.array(ProjectFolderRecordSchema),
    counts: z.record(z.number().int().nonnegative()),
  })
  .strict();

export interface FolderListWithCounts {
  folders: ProjectFolderRecord[];
  /** key 为 folderId；`'uncategorized'` 表示未分类的项目数。 */
  counts: Record<string, number>;
}

export async function listStudioFolders(): Promise<FolderListWithCounts> {
  const user = await requireStudioUser();
  const cache = getStudioCache();
  const cacheKey = folderListCacheKey(user.id);
  const cached = await cache.get(cacheKey, FolderListWithCountsSchema);
  if (cached) return cached;

  const folderRepo = await getProjectFolderRepository();
  const projectRepo = await getProjectRepository();

  const retiredFolderIds = await folderRepo.retireLegacySystemFolders(user.id);
  if (retiredFolderIds.length > 0) {
    await clearRetiredProjectFoldersWithCacheInvalidation({
      actorUserId: user.id,
      cache: getStudioProjectQueries(),
      folderIds: retiredFolderIds,
      repository: projectRepo,
    });
  }

  const [folders, counts] = await Promise.all([
    folderRepo.list({ ownerId: user.id }),
    projectRepo.countByFolder(user.id),
  ]);
  const result = { folders, counts };
  await cache.set(cacheKey, result, FOLDER_LIST_CACHE_TTL_SECONDS);
  return result;
}

export async function createStudioFolder(name: string): Promise<ProjectFolderRecord> {
  const user = await requireStudioUser();
  const folderRepo = await getProjectFolderRepository();
  const folder = await folderRepo.create({ ownerId: user.id, name });
  await invalidateFolderListCache(user.id);
  return folder;
}

export async function updateStudioFolder(
  folderId: string,
  input: UpdateProjectFolderInput,
): Promise<ProjectFolderRecord | null> {
  const user = await requireStudioUser();
  const folderRepo = await getProjectFolderRepository();
  const folder = await folderRepo.update(user.id, folderId, input);
  if (folder) await invalidateFolderListCache(user.id);
  return folder;
}

/**
 * 删除文件夹：连带里面所有工作流一起软删（前端必须已经做过二次确认）。
 */
export async function deleteStudioFolder(folderId: string): Promise<boolean> {
  const user = await requireStudioUser();
  const folderRepo = await getProjectFolderRepository();
  const projectRepo = await getProjectRepository();
  return deleteFolderWithProjectCacheInvalidation({
    actorUserId: user.id,
    cache: getStudioProjectQueries(),
    deleteFolder: () => folderRepo.delete(user.id, folderId),
    folderId,
    invalidateFolderList: () => invalidateFolderListCache(user.id),
    repository: projectRepo,
  });
}

function folderListCacheKey(ownerId: string) {
  return `folders:${ownerId}:list:v2`;
}

async function invalidateFolderListCache(ownerId: string) {
  await getStudioCache().delete(folderListCacheKey(ownerId));
}
