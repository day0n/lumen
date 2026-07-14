import { z } from 'zod';

export const ProjectStatusSchema = z.enum(['draft', 'running', 'done', 'failed', 'archived']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const CanvasPositionSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
  })
  .strict();

export const CanvasViewportSchema = z
  .object({
    x: z.number().finite(),
    y: z.number().finite(),
    zoom: z.number().finite().positive(),
  })
  .strict();

export const CanvasNodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().min(1).optional(),
    position: CanvasPositionSchema,
    data: z.record(z.unknown()).default({}),
    selected: z.boolean().optional(),
    dragging: z.boolean().optional(),
    width: z.number().finite().optional(),
    height: z.number().finite().optional(),
    measured: z
      .object({
        width: z.number().finite().optional(),
        height: z.number().finite().optional(),
      })
      .optional(),
  })
  .passthrough();
export type CanvasNodeRecord = z.infer<typeof CanvasNodeSchema>;

export const CanvasEdgeSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    sourceHandle: z.string().nullable().optional(),
    targetHandle: z.string().nullable().optional(),
    type: z.string().min(1).optional(),
    data: z.record(z.unknown()).default({}),
    selected: z.boolean().optional(),
  })
  .passthrough();
export type CanvasEdgeRecord = z.infer<typeof CanvasEdgeSchema>;

export const ProjectCanvasSchema = z
  .object({
    nodes: z.array(CanvasNodeSchema).default([]),
    edges: z.array(CanvasEdgeSchema).default([]),
    viewport: CanvasViewportSchema.optional(),
  })
  .strict();
export type ProjectCanvas = z.infer<typeof ProjectCanvasSchema>;

export const ProjectDocumentSchema = z
  .object({
    _id: z.string().min(1),
    owner_id: z.string().min(1),
    title: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional(),
    status: ProjectStatusSchema.default('draft'),
    thumbnail: z.string().trim().optional(),
    share_id: z.string().trim().min(1).optional(),
    source_share_id: z.string().trim().min(1).optional(),
    active_clone_key: z.string().trim().min(1).optional(),
    clone_history_recorded_at: z.date().optional(),
    /** 文件夹 id；未设置 = "未分类"。 */
    folder_id: z.string().trim().min(1).optional(),
    canvas: ProjectCanvasSchema.default({ nodes: [], edges: [] }),
    created_at: z.date(),
    updated_at: z.date(),
    deleted_at: z.date().optional(),
  })
  .strict();
export type ProjectDocument = z.infer<typeof ProjectDocumentSchema>;

export const ProjectRecordSchema = z
  .object({
    id: z.string().min(1),
    ownerId: z.string().min(1),
    title: z.string().min(1).max(120),
    description: z.string().optional(),
    status: ProjectStatusSchema,
    thumbnail: z.string().optional(),
    folderId: z.string().optional(),
    canvas: ProjectCanvasSchema,
    createdAt: z.string().datetime(),
    updatedAt: z.string().datetime(),
  })
  .strict();
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;

export const ProjectListRecordSchema = ProjectRecordSchema.omit({ canvas: true }).strict();
export type ProjectListRecord = z.infer<typeof ProjectListRecordSchema>;

export const CreateProjectInputSchema = z
  .object({
    ownerId: z.string().min(1),
    title: z.string().trim().min(1).max(120).default('未命名画布'),
    description: z.string().trim().max(1000).optional(),
    thumbnail: z.string().trim().optional(),
    folderId: z.string().trim().min(1).optional(),
    canvas: ProjectCanvasSchema.optional(),
  })
  .strict();
export type CreateProjectInput = z.input<typeof CreateProjectInputSchema>;

export const UpdateProjectInputSchema = z
  .object({
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    status: ProjectStatusSchema.optional(),
    thumbnail: z.string().trim().nullable().optional(),
    /** 传 null = 移到"未分类"。 */
    folderId: z.string().trim().min(1).nullable().optional(),
    canvas: ProjectCanvasSchema.optional(),
  })
  .strict();
export type UpdateProjectInput = z.infer<typeof UpdateProjectInputSchema>;

/** `folderId` 取值：字符串 = 该文件夹下；`'uncategorized'` = 未分类；`undefined` = 全部。 */
export const ProjectFolderFilterSchema = z.union([
  z.string().trim().min(1),
  z.literal('uncategorized'),
]);

export const ListProjectsInputSchema = z
  .object({
    ownerId: z.string().min(1),
    limit: z.number().int().min(1).max(100).default(50),
    query: z.string().trim().max(120).optional(),
    folderId: ProjectFolderFilterSchema.optional(),
  })
  .strict();
export type ListProjectsInput = z.input<typeof ListProjectsInputSchema>;
