import { z } from 'zod';
import { ProjectCanvasSchema } from './project.js';

export const ProjectHistoryActionSchema = z.enum(['created', 'updated', 'restored']);
export type ProjectHistoryAction = z.infer<typeof ProjectHistoryActionSchema>;

export const ProjectHistoryDocumentSchema = z
  .object({
    _id: z.string().min(1),
    owner_id: z.string().min(1),
    project_id: z.string().min(1),
    title: z.string().trim().min(1).max(120),
    action: ProjectHistoryActionSchema,
    canvas: ProjectCanvasSchema,
    node_count: z.number().int().nonnegative(),
    edge_count: z.number().int().nonnegative(),
    created_at: z.date(),
  })
  .strict();
export type ProjectHistoryDocument = z.infer<typeof ProjectHistoryDocumentSchema>;

export const ProjectHistoryRecordSchema = z
  .object({
    id: z.string().min(1),
    ownerId: z.string().min(1),
    projectId: z.string().min(1),
    title: z.string().min(1),
    action: ProjectHistoryActionSchema,
    canvas: ProjectCanvasSchema,
    nodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    createdAt: z.string().datetime(),
  })
  .strict();
export type ProjectHistoryRecord = z.infer<typeof ProjectHistoryRecordSchema>;

export const ProjectHistorySummaryRecordSchema = ProjectHistoryRecordSchema.omit({
  canvas: true,
}).strict();
export type ProjectHistorySummaryRecord = z.infer<typeof ProjectHistorySummaryRecordSchema>;

export const RecordProjectHistoryInputSchema = z
  .object({
    ownerId: z.string().min(1),
    projectId: z.string().min(1),
    title: z.string().trim().min(1).max(120),
    action: ProjectHistoryActionSchema,
    canvas: ProjectCanvasSchema,
  })
  .strict();
export type RecordProjectHistoryInput = z.infer<typeof RecordProjectHistoryInputSchema>;

export const ListProjectHistoryInputSchema = z
  .object({
    ownerId: z.string().min(1),
    projectId: z.string().min(1),
    limit: z.number().int().min(1).max(20).default(3),
  })
  .strict();
export type ListProjectHistoryInput = z.input<typeof ListProjectHistoryInputSchema>;
