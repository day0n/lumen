import { z } from 'zod';

export const NodeTypeSchema = z.enum(['text', 'image', 'video', 'audio', 'composition']);
export type NodeType = z.infer<typeof NodeTypeSchema>;

export const NodeOutputTypeSchema = z.enum(['text', 'image', 'video', 'audio']);
export type NodeOutputType = z.infer<typeof NodeOutputTypeSchema>;

export const NodeStatusSchema = z.enum([
  'idle',
  'queued',
  'running',
  'success',
  'error',
  'cancelled',
]);
export type NodeStatus = z.infer<typeof NodeStatusSchema>;

export const VideoClipInputSchema = z.object({
  url: z.string().trim().min(1),
  start: z.number().nonnegative().optional(),
  duration: z.number().positive().optional(),
  volume: z.number().min(0).max(1).optional(),
  title: z.string().trim().max(120).optional(),
});
export type VideoClipInput = z.infer<typeof VideoClipInputSchema>;

export const NodeInputSchema = z.object({
  prompt: z.string().default(''),
  image: z.string().nullable().default(null),
  lastFrameImage: z.string().nullable().default(null),
  images: z.array(z.string().trim().min(1)).default([]),
  video: z.string().nullable().default(null),
  videos: z.array(z.string().trim().min(1)).default([]),
  audio: z.string().nullable().default(null),
  audios: z.array(z.string().trim().min(1)).default([]),
  clips: z.array(VideoClipInputSchema).default([]),
});
export type NodeInput = z.infer<typeof NodeInputSchema>;

export const ModelConfigSchema = z.object({
  id: z.string(),
  settings: z.record(z.unknown()).default({}),
});
export type ModelConfig = z.infer<typeof ModelConfigSchema>;

export const NodeSchema = z.object({
  id: z.string(),
  type: NodeTypeSchema,
  position: z.object({ x: z.number(), y: z.number() }),
  output: z.string().nullable().default(null),
  input: NodeInputSchema,
  model: ModelConfigSchema,
});
export type WorkflowNode = z.infer<typeof NodeSchema>;

export const EdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
});
export type WorkflowEdge = z.infer<typeof EdgeSchema>;

export const NodeOutputSchema = z.object({
  type: NodeOutputTypeSchema,
  value: z.string(),
});
export type NodeOutput = z.infer<typeof NodeOutputSchema>;
