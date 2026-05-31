/**
 * Anthropic provider —— 流式调用 Claude，支持 thinking blocks。
 *
 *  - 把 system 抽出来放到顶层
 *  - tool_calls：把 OpenAI 风格的 tool_calls 转成 Anthropic 的 tool_use blocks
 *  - tool 角色消息：转成 user role + tool_result block
 *  - thinking blocks：从 ContentBlockStartEvent 累积，最后一起 emit
 */

import Anthropic from '@anthropic-ai/sdk';
import { nanoid } from 'nanoid';

import { logger } from '../observability/logger.js';
import type {
  AssistantMessage,
  ChatMessage,
  ToolCallDict,
  ToolMessage,
} from '../schemas/messages.js';
import type { ToolCallRequest } from '../schemas/providers.js';

import { type ChatOptions, LLMProvider, type LLMStreamChunk, type ToolDefinition } from './base.js';

const DEFAULT_MODEL = 'claude-sonnet-4-6';

interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

interface AnthropicThinkingBlock {
  type: 'thinking';
  thinking: string;
  signature?: string;
}

interface AnthropicToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string;
  is_error?: boolean;
}

type AnthropicBlock =
  | AnthropicTextBlock
  | AnthropicToolUseBlock
  | AnthropicThinkingBlock
  | AnthropicToolResultBlock;

interface AnthropicMessage {
  role: 'user' | 'assistant';
  content: AnthropicBlock[] | string;
}

function convertSystem(messages: ChatMessage[]): { system: string; rest: ChatMessage[] } {
  const systems: string[] = [];
  const rest: ChatMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
      systems.push(c);
    } else {
      rest.push(m);
    }
  }
  return { system: systems.join('\n\n'), rest };
}

function assistantToBlocks(m: AssistantMessage): AnthropicBlock[] {
  const blocks: AnthropicBlock[] = [];
  if (m.thinking_blocks) {
    for (const tb of m.thinking_blocks) {
      blocks.push({
        type: 'thinking',
        thinking: String(tb.thinking ?? tb.text ?? ''),
        signature: tb.signature ? String(tb.signature) : undefined,
      });
    }
  }
  const content = m.content;
  if (typeof content === 'string' && content) {
    blocks.push({ type: 'text', text: content });
  } else if (Array.isArray(content)) {
    for (const c of content) {
      if (typeof c === 'object' && c !== null && (c as { type?: string }).type === 'text') {
        blocks.push({ type: 'text', text: String((c as { text: string }).text ?? '') });
      }
    }
  }
  if (m.tool_calls) {
    for (const tc of m.tool_calls) {
      let input: Record<string, unknown>;
      try {
        input = JSON.parse(tc.function.arguments) as Record<string, unknown>;
      } catch {
        input = {};
      }
      blocks.push({
        type: 'tool_use',
        id: tc.id,
        name: tc.function.name,
        input,
      });
    }
  }
  return blocks;
}

function toolMessageToBlock(m: ToolMessage): AnthropicToolResultBlock {
  return {
    type: 'tool_result',
    tool_use_id: m.tool_call_id,
    content: m.content,
  };
}

function userContentToBlocks(content: ChatMessage['content']): AnthropicBlock[] | string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  // 多模态 content：透传 text 块
  const out: AnthropicBlock[] = [];
  for (const c of content) {
    const obj = c as { type?: string; text?: string };
    if (obj.type === 'text' && typeof obj.text === 'string') {
      out.push({ type: 'text', text: obj.text });
    }
  }
  return out;
}

function convertMessages(rest: ChatMessage[]): AnthropicMessage[] {
  const out: AnthropicMessage[] = [];
  let pendingToolResults: AnthropicToolResultBlock[] = [];

  const flushToolResults = () => {
    if (pendingToolResults.length > 0) {
      out.push({ role: 'user', content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const m of rest) {
    if (m.role === 'tool') {
      pendingToolResults.push(toolMessageToBlock(m));
      continue;
    }
    flushToolResults();
    if (m.role === 'user') {
      out.push({ role: 'user', content: userContentToBlocks(m.content) });
    } else if (m.role === 'assistant') {
      const blocks = assistantToBlocks(m);
      if (blocks.length === 0) blocks.push({ type: 'text', text: '(empty)' });
      out.push({ role: 'assistant', content: blocks });
    }
  }
  flushToolResults();
  return out;
}

function convertTools(tools: ToolDefinition[] | undefined) {
  if (!tools) return undefined;
  return tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters,
  }));
}

export class AnthropicProvider extends LLMProvider {
  private client: Anthropic;

  constructor(opts: { apiKey: string; apiBase?: string } = { apiKey: '' }) {
    super(opts);
    // 显式锁住 baseURL / 关掉 authToken，避免被 shell 里的
    // ANTHROPIC_BASE_URL / ANTHROPIC_AUTH_TOKEN（claude-code / kiro-proxy
    // 这种本地代理常设）劫持。
    this.client = new Anthropic({
      apiKey: opts.apiKey,
      baseURL: opts.apiBase ?? 'https://api.anthropic.com',
      authToken: null,
    });
    this.generation.maxTokens = 8192;
  }

  override getDefaultModel(): string {
    return DEFAULT_MODEL;
  }

  override async *chatStream(opts: ChatOptions): AsyncGenerator<LLMStreamChunk, void, unknown> {
    const model = opts.model ?? this.getDefaultModel();
    const { system, rest } = convertSystem(opts.messages);
    const messages = convertMessages(rest);
    const tools = convertTools(opts.tools);

    const params: Anthropic.Messages.MessageStreamParams = {
      model,
      max_tokens: opts.maxTokens ?? this.generation.maxTokens,
      messages: messages as unknown as Anthropic.Messages.MessageParam[],
      system: system || undefined,
      tools: tools as unknown as Anthropic.Messages.Tool[] | undefined,
      tool_choice:
        opts.toolChoice === 'auto'
          ? { type: 'auto' }
          : opts.toolChoice === 'required'
            ? { type: 'any' }
            : opts.toolChoice
              ? { type: 'tool', name: opts.toolChoice.function.name }
              : undefined,
      temperature: opts.temperature ?? this.generation.temperature ?? undefined,
    };

    const stream = this.client.messages.stream(params);

    let currentToolUse: { id: string; name: string; jsonAcc: string } | null = null;
    const thinkingBlocks: Array<Record<string, unknown>> = [];
    let currentThinking: { thinking: string; signature?: string } | null = null;
    let inputTokens = 0;
    let cacheRead = 0;
    let cacheCreation = 0;

    try {
      for await (const event of stream) {
        if (event.type === 'message_start') {
          const usage = (event.message as unknown as { usage?: Record<string, number> }).usage;
          if (usage) {
            inputTokens = usage.input_tokens ?? 0;
            cacheRead = usage.cache_read_input_tokens ?? 0;
            cacheCreation = usage.cache_creation_input_tokens ?? 0;
          }
        } else if (event.type === 'content_block_start') {
          const block = event.content_block;
          if (block.type === 'tool_use') {
            currentToolUse = { id: block.id, name: block.name, jsonAcc: '' };
          } else if ((block as { type: string }).type === 'thinking') {
            currentThinking = { thinking: '' };
          }
        } else if (event.type === 'content_block_delta') {
          // SDK 类型只覆盖 TextDelta | InputJSONDelta，但 API 实际还会发
          // thinking_delta / signature_delta —— 用 any-cast 兼容。
          const delta = event.delta as
            | { type: 'text_delta'; text: string }
            | { type: 'input_json_delta'; partial_json: string }
            | { type: 'thinking_delta'; thinking: string }
            | { type: 'signature_delta'; signature: string };
          if (delta.type === 'text_delta') {
            yield { textDelta: delta.text };
          } else if (delta.type === 'thinking_delta') {
            if (currentThinking) currentThinking.thinking += delta.thinking;
            yield { thinkingDelta: delta.thinking };
          } else if (delta.type === 'signature_delta') {
            if (currentThinking) currentThinking.signature = delta.signature;
          } else if (delta.type === 'input_json_delta') {
            if (currentToolUse) currentToolUse.jsonAcc += delta.partial_json;
          }
        } else if (event.type === 'content_block_stop') {
          if (currentToolUse) {
            let parsed: Record<string, unknown> = {};
            if (currentToolUse.jsonAcc) {
              try {
                parsed = JSON.parse(currentToolUse.jsonAcc) as Record<string, unknown>;
              } catch (e) {
                logger.warn(
                  { err: e, raw: currentToolUse.jsonAcc },
                  'tool_use input JSON parse 失败',
                );
                parsed = {};
              }
            }
            yield {
              completedToolCalls: [
                {
                  id: currentToolUse.id,
                  name: currentToolUse.name,
                  arguments: parsed,
                },
              ],
            };
            currentToolUse = null;
          }
          if (currentThinking) {
            thinkingBlocks.push({ type: 'thinking', ...currentThinking });
            currentThinking = null;
          }
        } else if (event.type === 'message_delta') {
          const usage = event.usage;
          yield {
            finishReason: event.delta.stop_reason ?? undefined,
            usage: {
              prompt_tokens: inputTokens,
              completion_tokens: usage?.output_tokens ?? 0,
              cache_read_input_tokens: cacheRead,
              cache_creation_input_tokens: cacheCreation,
            },
            thinkingBlocks: thinkingBlocks.length > 0 ? thinkingBlocks : undefined,
          };
        }
      }
    } catch (err) {
      logger.error({ err }, 'Anthropic stream 异常');
      throw err;
    }
  }
}

// 用 nanoid 给本地构造的 tool_call_id 兜底（避免 anthropic id 格式不被 OpenAI 风格代码识别）
export function newCallId(): string {
  return `call_${nanoid(10)}`;
}

// 把 ToolCallRequest 转成 OpenAI 风格的 ToolCallDict（持久化用）
export function toToolCallDict(tc: ToolCallRequest): ToolCallDict {
  return {
    id: tc.id,
    type: 'function',
    function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
  };
}
