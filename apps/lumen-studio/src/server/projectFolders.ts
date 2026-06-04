import 'server-only';

import type {
  ProjectFolderRecord,
  ProjectFolderSystemKey,
  UpdateProjectFolderInput,
} from '@lumen/db';

import { requireStudioUser } from './auth';
import { getProjectFolderRepository, getProjectRepository } from './db';

/** 系统文件夹的默认 name；前端可按系统 key 翻译为本地化文案。 */
const SYSTEM_FOLDER_DEFAULTS: Record<ProjectFolderSystemKey, string> = {
  viral_remix: 'Viral remix',
};

export interface FolderListWithCounts {
  folders: ProjectFolderRecord[];
  /** key 为 folderId；`'uncategorized'` 表示未分类的项目数。 */
  counts: Record<string, number>;
}

export async function listStudioFolders(): Promise<FolderListWithCounts> {
  const user = await requireStudioUser();
  const folderRepo = await getProjectFolderRepository();
  const projectRepo = await getProjectRepository();
  const [folders, counts] = await Promise.all([
    folderRepo.list({ ownerId: user.id }),
    projectRepo.countByFolder(user.id),
  ]);
  return { folders, counts };
}

export async function createStudioFolder(name: string): Promise<ProjectFolderRecord> {
  const user = await requireStudioUser();
  const folderRepo = await getProjectFolderRepository();
  return folderRepo.create({ ownerId: user.id, name });
}

export async function updateStudioFolder(
  folderId: string,
  input: UpdateProjectFolderInput,
): Promise<ProjectFolderRecord | null> {
  const user = await requireStudioUser();
  const folderRepo = await getProjectFolderRepository();
  return folderRepo.update(user.id, folderId, input);
}

/**
 * 删除文件夹：先把里面的项目挪回未分类，再软删文件夹。返回是否成功（系统文件夹返回 false）。
 */
export async function deleteStudioFolder(folderId: string): Promise<boolean> {
  const user = await requireStudioUser();
  const folderRepo = await getProjectFolderRepository();
  const projectRepo = await getProjectRepository();
  await projectRepo.clearFolderForOwner(user.id, folderId);
  return folderRepo.delete(user.id, folderId);
}

/**
 * 系统文件夹的 idempotent 入口：保证当前用户有这个 system folder，并返回它。
 * 给爆款复刻这类后台业务用。
 */
export async function ensureStudioSystemFolder(
  systemKey: ProjectFolderSystemKey,
): Promise<ProjectFolderRecord> {
  const user = await requireStudioUser();
  const folderRepo = await getProjectFolderRepository();
  return folderRepo.ensureSystemFolder(user.id, systemKey, SYSTEM_FOLDER_DEFAULTS[systemKey]);
}
