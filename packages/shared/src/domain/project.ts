import { z } from 'zod';
import { EdgeSchema, NodeSchema } from './node.js';

export const ProjectStatusSchema = z.enum(['draft', 'running', 'done', 'failed']);
export type ProjectStatus = z.infer<typeof ProjectStatusSchema>;

export const ProjectSchema = z.object({
  id: z.string(),
  userId: z.string(),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  thumbnail: z.string().url().optional(),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  status: ProjectStatusSchema.default('draft'),
  productId: z.string().optional(),
  templateId: z.string().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Project = z.infer<typeof ProjectSchema>;
