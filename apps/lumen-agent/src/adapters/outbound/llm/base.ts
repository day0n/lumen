/**
 * LLMProvider 抽象基类（流式优先）。
 *
 * InferenceLoop 默认走 chatStreamWithRetry。保留：
 * - GenerationSettings 默认参数
 * - 重试规则（transient / non-retry / context-limit 三类错误）
 * - 流式重试三级策略：连接失败 / 首 chunk 是 error / 中途断流
 */

import { setTimeout as sleep } from 'node:timers/promises';

import * as Sentry from '@sentry/node';

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

// 重试节奏：指数退避，第 n 次失败后等待 BASE * 2^(n-1) 毫秒。
const RETRY_BASE_DELAY_MS = 800;
const MAX_STREAM_RETRIES = 3;

function retryDelayMs(attempt: number): number {
  return RETRY_BASE_DELAY_MS * 2 ** (attempt - 1);
}

// HTTP 状态码语义是通用约定：5xx 与限流通常值得重试，4xx 多为请求本身的问题。
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const FATAL_STATUS = new Set([400, 401, 403, 404, 422]);

const RETRYABLE_PHRASES = [
  'rate limit',
  'too many requests',
  'overloaded',
  'timeout',
  'timed out',
  'connection reset',
  'connection error',
  'econnreset',
  'etimedout',
  'server error',
  'service unavailable',
  'temporarily unavailable',
];

const CONTEXT_OVERFLOW_PHRASES = [
  'prompt is too long',
  'maximum context',
  'context length',
  'context_length_exceeded',
  'too many tokens',
  'exceeds the maximum',
];

const FATAL_PHRASES = [
  ...CONTEXT_OVERFLOW_PHRASES,
  'invalid_request_error',
  'bad request',
  'unauthorized',
  'forbidden',
];

/** 从错误文本里抠出独立出现的三位数状态码（"12429" 这类不会被误判）。 */
function extractStatusCodes(text: string): Set<number> {
  const codes = new Set<number>();
  for (const m of text.matchAll(/(?<!\d)(\d{3})(?!\d)/g)) {
    codes.add(Number(m[1]));
  }
  return codes;
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

    // gen_ai span 覆盖整个流式 + 重试过程，量到的就是对模型 API 的真实耗时。
    // 用 inactive span + try/finally，保证生成器任意退出路径都能 end()。
    const span = Sentry.startInactiveSpan({
      name: 'llm.chat',
      op: 'gen_ai.chat',
      attributes: {
        'gen_ai.system': provider,
        'gen_ai.request.model': resolvedModel,
        message_count: opts.messages.length,
        tool_count: opts.tools?.length ?? 0,
      },
    });

    try {
      for (let attempt = 1; attempt <= MAX_STREAM_RETRIES; attempt += 1) {
        let firstChunkReceived = false;
        try {
          for await (const chunk of this.chatStream(opts)) {
            firstChunkReceived = true;
            yield chunk;
            if (chunk.finishReason && chunk.usage) {
              for (const [k, v] of Object.entries(chunk.usage)) {
                span.setAttribute(`gen_ai.usage.${k}`, v);
              }
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

          const delay = retryDelayMs(attempt);
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
    } finally {
      span.end();
    }
  }

  // ── error classification ─────────────────────────────────────────

  static isTransient(content: string | null | undefined): boolean {
    const err = (content ?? '').toLowerCase();
    if (LLMProvider.isNonRetryable(err)) return false;
    const codes = extractStatusCodes(err);
    if ([...codes].some((c) => RETRYABLE_STATUS.has(c))) return true;
    return RETRYABLE_PHRASES.some((m) => err.includes(m));
  }

  static isNonRetryable(content: string | null | undefined): boolean {
    const err = (content ?? '').toLowerCase();
    const codes = extractStatusCodes(err);
    if ([...codes].some((c) => FATAL_STATUS.has(c))) return true;
    return FATAL_PHRASES.some((m) => err.includes(m));
  }

  static isContextLimit(content: string | null | undefined): boolean {
    const err = (content ?? '').toLowerCase();
    return CONTEXT_OVERFLOW_PHRASES.some((m) => err.includes(m));
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
