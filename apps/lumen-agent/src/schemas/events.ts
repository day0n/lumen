/**
 * SSE 事件 payload —— zod schema。
 */

import { z } from 'zod';

export const AgentStartedDataSchema = z.object({
  session_id: z.string(),
  run_id: z.string(),
});
export type AgentStartedData = z.infer<typeof AgentStartedDataSchema>;

export const AgentCompletedDataSchema = z.object({
  content: z.string(),
  usage: z.record(z.string(), z.number()).optional(),
});
export type AgentCompletedData = z.infer<typeof AgentCompletedDataSchema>;

export const AgentFailedDataSchema = z.object({
  error: z.string(),
  code: z.string().optional(),
  category: z.string().optional(),
  details: z.record(z.string(), z.unknown()).optional(),
});
export type AgentFailedData = z.infer<typeof AgentFailedDataSchema>;

export const StepDataSchema = z.object({
  iteration: z.number(),
});
export type StepData = z.infer<typeof StepDataSchema>;

export const ToolStartedDataSchema = z.object({
  tool_name: z.string(),
  tool_call_id: z.string(),
  arguments: z.record(z.string(), z.unknown()).default({}),
});
export type ToolStartedData = z.infer<typeof ToolStartedDataSchema>;

export const ToolCompletedDataSchema = z.object({
  tool_name: z.string(),
  tool_call_id: z.string(),
  output_size_bytes: z.number(),
  duration_ms: z.number().optional(),
  truncated: z.boolean().default(false),
  error: z.string().nullable().optional(),
  status: z.enum(['success', 'error']).default('success'),
});
export type ToolCompletedData = z.infer<typeof ToolCompletedDataSchema>;

export const ToolFailedDataSchema = z.object({
  tool_name: z.string(),
  tool_call_id: z.string(),
  error: z.string(),
});
export type ToolFailedData = z.infer<typeof ToolFailedDataSchema>;

export const ToolEventDataSchema = z.object({
  tool_name: z.string(),
  event: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
});
export type ToolEventData = z.infer<typeof ToolEventDataSchema>;

export const MessageDeltaDataSchema = z.object({
  content: z.string(),
});

export const ThinkingDeltaDataSchema = z.object({
  content: z.string(),
});
