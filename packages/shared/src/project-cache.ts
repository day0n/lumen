export const STUDIO_REDIS_KEY_PREFIX = 'lumen:studio:';

export const CACHED_PROJECT_LIST_LIMITS = [3, 50] as const;

export interface ProjectListCacheKeyOptions {
  query?: string;
  limit: number;
  folderId?: string;
}

export interface ProjectCacheDeletePort {
  delete(key: string): Promise<void>;
  deleteMany?(keys: readonly string[]): Promise<void>;
}

export interface ProjectCacheInvalidator {
  invalidateProject(actorUserId: string, projectId: string): Promise<void>;
  invalidateProjects(actorUserId: string, projectIds: readonly string[]): Promise<void>;
  invalidateProjectLists(actorUserId: string): Promise<void>;
}

export function projectDetailCacheKey(actorUserId: string, projectId: string): string {
  return `project:${actorUserId}:${projectId}`;
}

export function projectListCacheKey(
  actorUserId: string,
  options: ProjectListCacheKeyOptions,
): string {
  return `projects:${actorUserId}:list:limit:${options.limit}:f:${encodeURIComponent(
    options.folderId ?? '',
  )}:q:${encodeURIComponent(options.query ?? '')}`;
}

export function createProjectCacheInvalidator(options: {
  cache: ProjectCacheDeletePort;
  keyPrefix?: string;
}): ProjectCacheInvalidator {
  const keyPrefix = options.keyPrefix ?? '';
  const deleteKeys = async (keys: readonly string[]) => {
    const prefixedKeys = keys.map((key) => `${keyPrefix}${key}`);
    if (options.cache.deleteMany) {
      for (let offset = 0; offset < prefixedKeys.length; offset += 200) {
        await options.cache.deleteMany(prefixedKeys.slice(offset, offset + 200));
      }
      return;
    }
    for (let offset = 0; offset < prefixedKeys.length; offset += 200) {
      await Promise.all(
        prefixedKeys.slice(offset, offset + 200).map((key) => options.cache.delete(key)),
      );
    }
  };
  const listKeys = (actorUserId: string) =>
    CACHED_PROJECT_LIST_LIMITS.map((limit) => projectListCacheKey(actorUserId, { limit }));

  return {
    async invalidateProject(actorUserId, projectId) {
      assertIdentifier(actorUserId, 'actorUserId');
      assertIdentifier(projectId, 'projectId');
      await deleteKeys([projectDetailCacheKey(actorUserId, projectId), ...listKeys(actorUserId)]);
    },

    async invalidateProjects(actorUserId, projectIds) {
      assertIdentifier(actorUserId, 'actorUserId');
      const uniqueProjectIds = [...new Set(projectIds)];
      for (const projectId of uniqueProjectIds) assertIdentifier(projectId, 'projectId');
      await deleteKeys([
        ...uniqueProjectIds.map((projectId) => projectDetailCacheKey(actorUserId, projectId)),
        ...listKeys(actorUserId),
      ]);
    },

    async invalidateProjectLists(actorUserId) {
      assertIdentifier(actorUserId, 'actorUserId');
      await deleteKeys(listKeys(actorUserId));
    },
  };
}

function assertIdentifier(value: string, label: string): void {
  if (!value.trim()) throw new Error(`${label} is required`);
}
