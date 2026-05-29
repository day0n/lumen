import { z } from 'zod';
import { EdgeSchema, NodeSchema } from '../domain/node.js';

export const ClientMessageSchema = z.object({
  runId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  workflowId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  nodeIds: z.array(z.string()).optional(),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
});
export type ClientMessage = z.infer<typeof ClientMessageSchema>;

export const NodeQueuedEventSchema = z.object({
  event: z.literal('node:queued'),
  nodeId: z.string(),
});

export const NodeStartEventSchema = z.object({
  event: z.literal('node:start'),
  nodeId: z.string(),
});

export const NodeProgressEventSchema = z.object({
  event: z.literal('node:progress'),
  nodeId: z.string(),
  progress: z.number().min(0).max(1),
});

export const NodeDoneEventSchema = z.object({
  event: z.literal('node:done'),
  nodeId: z.string(),
  output: z.string(),
});

export const NodeErrorEventSchema = z.object({
  event: z.literal('node:error'),
  nodeId: z.string(),
  error: z.string(),
});

export const FlowDoneEventSchema = z.object({
  event: z.literal('flow:done'),
});

export const ServerEventSchema = z.discriminatedUnion('event', [
  NodeQueuedEventSchema,
  NodeStartEventSchema,
  NodeProgressEventSchema,
  NodeDoneEventSchema,
  NodeErrorEventSchema,
  FlowDoneEventSchema,
]);
export type ServerEvent = z.infer<typeof ServerEventSchema>;
