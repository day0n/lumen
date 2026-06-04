import type { Span } from '@sentry/node';

import type { ToolDefinition } from '../adapters/outbound/llm/base.js';
import type { MessageList } from '../domain/contracts/messages.js';
import type { ToolCallRequest } from '../domain/contracts/providers.js';

type Usage = Record<string, number | undefined>;

export function stringifyForSentry(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function setJsonAttribute(span: Span, key: string, value: unknown): void {
  span.setAttribute(key, stringifyForSentry(value));
}

export function setGenAiUsageAttributes(span: Span, usage: Usage | null | undefined): void {
  if (!usage) return;

  const cacheRead = firstNumber(
    usage.cache_read_input_tokens,
    usage.cached_input_tokens,
    usage.input_tokens_cached,
  );
  const cacheWrite = firstNumber(
    usage.cache_creation_input_tokens,
    usage.cache_write_input_tokens,
    usage.input_tokens_cache_write,
  );
  const reasoning = firstNumber(usage.reasoning_tokens, usage.output_tokens_reasoning);

  let input = firstNumber(usage.input_tokens, usage.prompt_tokens);
  if (input !== undefined) {
    const cachePortion = (cacheRead ?? 0) + (cacheWrite ?? 0);
    if (cachePortion > input) input += cachePortion;
    span.setAttribute('gen_ai.usage.input_tokens', input);
  }

  let output = firstNumber(usage.output_tokens, usage.completion_tokens);
  if (output !== undefined) {
    if (reasoning !== undefined && reasoning > output) output += reasoning;
    span.setAttribute('gen_ai.usage.output_tokens', output);
  }

  const total = firstNumber(usage.total_tokens);
  if (total !== undefined) {
    span.setAttribute('gen_ai.usage.total_tokens', total);
  } else if (input !== undefined || output !== undefined) {
    span.setAttribute('gen_ai.usage.total_tokens', (input ?? 0) + (output ?? 0));
  }

  if (cacheRead !== undefined) span.setAttribute('gen_ai.usage.input_tokens.cached', cacheRead);
  if (cacheWrite !== undefined)
    span.setAttribute('gen_ai.usage.input_tokens.cache_write', cacheWrite);
  if (reasoning !== undefined) span.setAttribute('gen_ai.usage.output_tokens.reasoning', reasoning);
}

export function collectToolCalls(messages: MessageList): Array<Record<string, unknown>> {
  const out: Array<Record<string, unknown>> = [];
  for (const message of messages) {
    if (message.role !== 'assistant') continue;
    for (const toolCall of message.tool_calls ?? []) {
      out.push({
        id: toolCall.id,
        type: toolCall.type,
        name: toolCall.function.name,
        arguments: toolCall.function.arguments,
      });
    }
  }
  return out;
}

export function toSentryToolCalls(toolCalls: ToolCallRequest[]): Array<Record<string, unknown>> {
  return toolCalls.map((toolCall) => ({
    id: toolCall.id,
    type: 'function_call',
    name: toolCall.name,
    arguments: toolCall.arguments,
  }));
}

export function toSentryAvailableTools(
  tools: ToolDefinition[] | undefined,
): Array<Record<string, unknown>> {
  return (tools ?? []).map((tool) => ({
    name: tool.function.name,
    type: tool.type,
    description: tool.function.description,
    parameters: tool.function.parameters,
  }));
}

function firstNumber(...values: Array<number | undefined>): number | undefined {
  return values.find((value) => typeof value === 'number' && Number.isFinite(value));
}
