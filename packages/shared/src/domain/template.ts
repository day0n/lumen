import { z } from 'zod';
import { EdgeSchema, NodeSchema } from './node';

export const TemplateExposedInputSchema = z.object({
  nodeId: z.string(),
  fieldName: z.string(),
  label: z.string(),
  type: z.enum(['text', 'image', 'select', 'slider']),
  options: z.array(z.string()).optional(),
  default: z.unknown().optional(),
});
export type TemplateExposedInput = z.infer<typeof TemplateExposedInputSchema>;

export const TemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  coverUrl: z.string().url(),
  isOfficial: z.boolean().default(false),
  workflow: z.object({
    nodes: z.array(NodeSchema),
    edges: z.array(EdgeSchema),
  }),
  exposedInputs: z.array(TemplateExposedInputSchema),
  usageCount: z.number().default(0),
  rating: z.number().default(0),
  authorId: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type Template = z.infer<typeof TemplateSchema>;
