/**
 * Provider 响应契约 —— zod 强校验。
 * Provider → executor 边界必须严格。
 */

import { z } from 'zod';

const argumentsCoerce = z.preprocess(
  (v) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) return v;
    if (typeof v === 'string') {
      try {
        const parsed = JSON.parse(v);
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
          ? parsed
          : { _raw: parsed };
      } catch {
        return { _raw: v };
      }
    }
    if (Array.isArray(v)) return { _items: v };
    return { _raw: v };
  },
  z.record(z.string(), z.unknown()),
);

export const ToolCallRequestSchema = z.object({
  id: z.string(),
  name: z.string(),
  arguments: argumentsCoerce,
  provider_specific_fields: z.record(z.string(), z.unknown()).optional().nullable(),
  function_provider_specific_fields: z.record(z.string(), z.unknown()).optional().nullable(),
});

export type ToolCallRequest = z.infer<typeof ToolCallRequestSchema>;

export const LLMResponseSchema = z.object({
  content: z.string().nullable().default(null),
  tool_calls: z.array(ToolCallRequestSchema).default([]),
  finish_reason: z.string().default('stop'),
  usage: z.record(z.string(), z.number()).default({}),
  reasoning_content: z.string().nullable().optional(),
  thinking_blocks: z.array(z.record(z.string(), z.unknown())).nullable().optional(),
});

export type LLMResponse = z.infer<typeof LLMResponseSchema>;

export function toOpenAIToolCall(tc: ToolCallRequest): ToolCallDictLike {
  const out: ToolCallDictLike = {
    id: tc.id,
    type: 'function',
    function: {
      name: tc.name,
      arguments: JSON.stringify(tc.arguments),
    },
  };
  if (tc.provider_specific_fields) out.provider_specific_fields = tc.provider_specific_fields;
  if (tc.function_provider_specific_fields) {
    out.function.provider_specific_fields = tc.function_provider_specific_fields;
  }
  return out;
}

interface ToolCallDictLike {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
    provider_specific_fields?: Record<string, unknown>;
  };
  provider_specific_fields?: Record<string, unknown>;
}
