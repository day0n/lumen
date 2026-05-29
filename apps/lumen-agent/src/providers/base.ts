/**
 * LLMProvider 抽象基类（流式优先）。
 *
 * AgentExecutor 默认走 chatStreamWithRetry。保留：
 * - GenerationSettings 默认参数
 * - 重试规则（transient / non-retry / context-limit 三类错误）
 * - 流式重试三级策略：连接失败 / 首 chunk 是 error / 中途断流
 */

import { setTimeout as sleep } from 'node:timers/promises';

import { logger } from '../observability/logger.js';
import type {
  AssistantMessage,
  ChatMessage,
  MessageList,
  SystemMessage,
  ToolMessage,
  UserMessage,
} from '../schemas/messages.js';
import type { LLMResponse, ToolCallRequest } from '../schemas/providers.js';

export interface GenerationSettings {
  temperature: number | null;
  maxTokens: number;
  reasoningEffort: string | null;
}

export const DEFAULT_GENERATION: GenerationSettings = {
  temperature: 0.7,
  maxTokens: 4096,
  reasoningEffort: null,
};

export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export type ToolChoice = 'auto' | 'required' | { type: 'function'; function: { name: string } };

export interface ChatOptions {
  messages: MessageList;
  tools?: ToolDefinition[];
  model?: string;
  maxTokens?: number;
  temperature?: number | null;
  reasoningEffort?: string | null;
  toolChoice?: ToolChoice;
}

/** 单个流式 chunk。 */
export interface LLMStreamChunk {
  textDelta?: string;
  thinkingDelta?: string;
  /** Gemini / Anthropic 完成的 tool_call 可能在中途任何 chunk 到达。 */
  completedToolCalls?: ToolCallRequest[];
  finishReason?: string;
  thinkingBlocks?: Array<Record<string, unknown>>;
  usage?: Record<string, number>;
  /** 流中途出错，不应再重试。 */
  errorContent?: string;
}

const CHAT_RETRY_DELAYS_MS = [1000, 2000, 4000] as const;

const TRANSIENT_MARKERS = [
  'rate limit',
  'overloaded',
  'timeout',
  'timed out',
  'connection',
  'server error',
  'temporarily unavailable',
];

const TRANSIENT_STATUS_CODES = [429, 500, 502, 503, 504];

const NON_RETRY_STATUS_CODES = [400, 401, 403, 404, 422];

const CONTEXT_LIMIT_MARKERS = [
  'prompt is too long',
  'maximum context length',
  'context length exceeded',
  'context_length_exceeded',
  'too many tokens',
  'exceeds maximum',
];

const NON_RETRY_MARKERS = [
  ...CONTEXT_LIMIT_MARKERS,
  'invalid_request_error',
  'bad request',
  'unauthorized',
  'forbidden',
];

function hasStatusCode(s: string, code: number): boolean {
  return new RegExp(`(?<!\\d)${code}(?!\\d)`).test(s);
}

export abstract class LLMProvider {
  protected readonly apiKey: string | undefined;
  protected readonly apiBase: string | undefined;
  generation: GenerationSettings = { ...DEFAULT_GENERATION };

  constructor(opts: { apiKey?: string; apiBase?: string } = {}) {
    this.apiKey = opts.apiKey;
    this.apiBase = opts.apiBase;
  }

  abstract getDefaultModel(): string;

  /**
   * 非流式调用 —— 默认从 chatStream 聚合。子类可覆盖以走原生 SDK 非流式接口。
   */
  async chat(opts: ChatOptions): Promise<LLMResponse> {
    let content = '';
    let thinking = '';
    const toolCalls: ToolCallRequest[] = [];
    let finishReason = 'stop';
    let usage: Record<string, number> = {};
    let thinkingBlocks: Array<Record<string, unknown>> | null = null;
    let errored: string | null = null;

    for await (const chunk of this.chatStream(opts)) {
      if (chunk.textDelta) content += chunk.textDelta;
      if (chunk.thinkingDelta) thinking += chunk.thinkingDelta;
      if (chunk.completedToolCalls) toolCalls.push(...chunk.completedToolCalls);
      if (chunk.finishReason) finishReason = chunk.finishReason;
      if (chunk.usage) usage = { ...usage, ...chunk.usage };
      if (chunk.thinkingBlocks) thinkingBlocks = chunk.thinkingBlocks;
      if (chunk.errorContent) errored = chunk.errorContent;
    }

    return {
      content: errored ?? (content || null),
      tool_calls: toolCalls,
      finish_reason: errored ? 'error' : finishReason,
      usage,
      reasoning_content: thinking || null,
      thinking_blocks: thinkingBlocks,
    };
  }

  /** 流式调用 —— 必须由子类实现。 */
  abstract chatStream(opts: ChatOptions): AsyncGenerator<LLMStreamChunk, void, unknown>;

  /** 流式 + 重试。executor 调这个。 */
  async *chatStreamWithRetry(opts: ChatOptions): AsyncGenerator<LLMStreamChunk, void, unknown> {
    const provider = this.constructor.name;
    const resolvedModel = opts.model ?? this.getDefaultModel();
    logger.info(
      {
        provider,
        model: resolvedModel,
        message_count: opts.messages.length,
        tool_count: opts.tools?.length ?? 0,
        max_tokens: opts.maxTokens,
        temperature: opts.temperature,
        reasoning_effort: opts.reasoningEffort,
        tool_choice: opts.toolChoice,
      },
      'LLM 流式请求',
    );

    for (let attempt = 1; attempt <= CHAT_RETRY_DELAYS_MS.length; attempt += 1) {
      let firstChunkReceived = false;
      try {
        for await (const chunk of this.chatStream(opts)) {
          firstChunkReceived = true;
          yield chunk;
          if (chunk.finishReason && chunk.usage) {
            logger.info(
              { provider, model: resolvedModel, attempt, usage: chunk.usage },
              'LLM stream done',
            );
          }
        }
        return;
      } catch (err) {
        const errStr = err instanceof Error ? err.message : String(err);
        if (firstChunkReceived) {
          logger.error({ err, provider, model: resolvedModel }, 'LLM 流式响应中断');
          yield { finishReason: 'error', errorContent: `Stream interrupted: ${errStr}` };
          return;
        }

        const transient = LLMProvider.isTransient(errStr);
        if (!transient) {
          logger.warn({ err, provider }, 'LLM 流式请求遇到不可重试错误');
          yield { finishReason: 'error', errorContent: `Error calling LLM: ${errStr}` };
          return;
        }

        const delay = CHAT_RETRY_DELAYS_MS[attempt - 1] ?? 4000;
        logger.warn(
          { provider, model: resolvedModel, attempt, delay_ms: delay, err: errStr.slice(0, 200) },
          'LLM 流式请求遇到可重试异常',
        );
        await sleep(delay);
      }
    }

    // 最后一次裸跑，不再重试
    try {
      yield* this.chatStream(opts);
    } catch (err) {
      const errStr = err instanceof Error ? err.message : String(err);
      logger.error({ err }, 'LLM 流式请求重试后仍失败');
      yield { finishReason: 'error', errorContent: `Error calling LLM after retries: ${errStr}` };
    }
  }

  // ── error classification ─────────────────────────────────────────

  static isTransient(content: string | null | undefined): boolean {
    const err = (content ?? '').toLowerCase();
    if (LLMProvider.isNonRetryable(err)) return false;
    if (TRANSIENT_STATUS_CODES.some((c) => hasStatusCode(err, c))) return true;
    return TRANSIENT_MARKERS.some((m) => err.includes(m));
  }

  static isNonRetryable(content: string | null | undefined): boolean {
    const err = (content ?? '').toLowerCase();
    if (NON_RETRY_STATUS_CODES.some((c) => hasStatusCode(err, c))) return true;
    return NON_RETRY_MARKERS.some((m) => err.includes(m));
  }

  static isContextLimit(content: string | null | undefined): boolean {
    const err = (content ?? '').toLowerCase();
    return CONTEXT_LIMIT_MARKERS.some((m) => err.includes(m));
  }
}

// 类型守卫
export function isSystem(m: ChatMessage): m is SystemMessage {
  return m.role === 'system';
}
export function isUser(m: ChatMessage): m is UserMessage {
  return m.role === 'user';
}
export function isAssistant(m: ChatMessage): m is AssistantMessage {
  return m.role === 'assistant';
}
export function isToolMsg(m: ChatMessage): m is ToolMessage {
  return m.role === 'tool';
}
