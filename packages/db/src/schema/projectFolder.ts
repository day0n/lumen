import { z } from 'zod';

/**
 * 工作室项目的"文件夹"：用户给工作流分组的容器。
 *
 * - `system_key` 标记内置文件夹（如 'viral_remix' 爆款复刻），不允许重命名或删除。
 *   普通用户文件夹无此字段。
 * - `sort_order` 用于稳定排序（小的在前）；普通文件夹按创建时间递增分配，
 *   系统文件夹保留较小的 sort_order 让它们永远在最上面。
 */

export const ProjectFolderSystemKeySchema = z.enum(['viral_remix']);
export type ProjectFolderSystemKey = z.infer<typeof ProjectFolderSystemKeySchema>;

export const ProjectFolderDocumentSchema = z
  .object({
    _id: z.string().min(1),
    owner_id: z.string().min(1),
    name: z.string().trim().min(1).max(80),
    system_key: ProjectFolderSystemKeySchema.optional(),
    sort_order: z.number().int().default(0),
    created_at: z.date(),
    updated_at: z.date(),
    deleted_at: z.date().optional(),
  })
  .strict();
export type ProjectFolderDocument = z.infer<typeof ProjectFolderDocumentSchema>;

export const ProjectFolderRecordSchema = z
  .object({
    id: z.string().min(1),
    ownerId: z.string().min(1),
    name: z.string().min(1).max(80),
    systemKey: ProjectFolderSystemKeySchema.optional(),
    sortOrder: z.number().int(),
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type ProjectFolderRecord = z.infer<typeof ProjectFolderRecordSchema>;

export const CreateProjectFolderInputSchema = z
  .object({
    ownerId: z.string().min(1),
    name: z.string().trim().min(1).max(80),
    systemKey: ProjectFolderSystemKeySchema.optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();
export type CreateProjectFolderInput = z.input<typeof CreateProjectFolderInputSchema>;

export const UpdateProjectFolderInputSchema = z
  .object({
    name: z.string().trim().min(1).max(80).optional(),
    sortOrder: z.number().int().optional(),
  })
  .strict();
export type UpdateProjectFolderInput = z.infer<typeof UpdateProjectFolderInputSchema>;

export const ListProjectFoldersInputSchema = z
  .object({
    ownerId: z.string().min(1),
  })
  .strict();
export type ListProjectFoldersInput = z.input<typeof ListProjectFoldersInputSchema>;
