import { z } from 'zod';
import { EdgeSchema, NodeSchema } from '../domain/node.js';

// W3C/Sentry 分布式追踪上下文，由浏览器注入，经 studio WS gateway 透传到
// Redis stream，再被 engine 读出来续接同一条 trace。纯数据字段，不引入任何
// Sentry 运行时（shared 会被打进前端 bundle）。
export const TraceContextSchema = z.object({
  sentryTrace: z.string(),
  baggage: z.string().optional(),
});
export type TraceContext = z.infer<typeof TraceContextSchema>;

export const ClientMessageSchema = z.object({
  runId: z.string().min(1).optional(),
  projectId: z.string().min(1).optional(),
  workflowId: z.string().min(1).optional(),
  userId: z.string().min(1).optional(),
  nodeIds: z.array(z.string()).optional(),
  nodes: z.array(NodeSchema),
  edges: z.array(EdgeSchema),
  trace: TraceContextSchema.optional(),
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
