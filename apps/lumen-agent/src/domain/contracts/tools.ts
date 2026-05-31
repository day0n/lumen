/**
 * Tool 契约 —— zod 校验。Tool → executor 边界严格。
 */

import { z } from 'zod';

export const ToolEventPayloadSchema = z.object({
  name: z.string(),
  data: z.record(z.string(), z.unknown()).default({}),
});

export type ToolEventPayload = z.infer<typeof ToolEventPayloadSchema>;

export const ToolResultSchema = z.object({
  content: z.string(),
  events: z.array(ToolEventPayloadSchema).default([]),
  interrupt: z.boolean().default(false),
  cost_usd: z.number().nullable().optional(),
  prompt_injection: z.string().nullable().optional(),
  system_prompt_blocks: z.array(z.record(z.string(), z.string())).nullable().optional(),
  hide_tools: z.array(z.string()).default([]),
  unhide_tools: z.array(z.string()).default([]),
});

export type ToolResult = z.infer<typeof ToolResultSchema>;

export function makeToolResult(content: string, opts: Partial<ToolResult> = {}): ToolResult {
  return ToolResultSchema.parse({ content, ...opts });
}

export function isToolResult(v: unknown): v is ToolResult {
  return (
    typeof v === 'object' &&
    v !== null &&
    'content' in v &&
    typeof (v as { content: unknown }).content === 'string'
  );
}
