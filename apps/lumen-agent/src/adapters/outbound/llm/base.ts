/**
 * LLMProvider 抽象基类（流式优先）。
 *
 * InferenceLoop 默认走 chatStreamWithRetry。保留：
 * - GenerationSettings 默认参数
 * - 失败归类（classifyFailure → retryable / permanent / context）驱动重试决策
 * - 流式重试三级策略：连接失败 / 首 chunk 是 error / 中途断流
 */

import { setTimeout as sleep } from 'node:timers/promises';

import * as Sentry from '@sentry/node';

import type { MessageList } from '../../../domain/contracts/messages.js';
import type { LLMResponse, ToolCallRequest } from '../../../domain/contracts/providers.js';
import { logger } from '../../../platform/logger.js';

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

type FailureKind = 'retryable' | 'permanent' | 'context';

// 上下文超限：各家 API 在 prompt 过长时回传的特征串。
const CONTEXT_MARKERS = [
  'context length',
  'context_length_exceeded',
  'maximum context',
  'exceeds the maximum',
  'prompt is too long',
  'too many tokens',
];

// 请求本身有问题（鉴权 / 参数 / 格式），重试不会变好。
const PERMANENT_MARKERS = ['unauthorized', 'forbidden', 'bad request', 'invalid_request_error'];

// 临时性故障：限流、过载、网络抖动，退避后通常能恢复。
const TRANSIENT_MARKERS = [
  'rate limit',
  'too many requests',
  'overloaded',
  'service unavailable',
  'temporarily unavailable',
  'server error',
  'timed out',
  'timeout',
  'connection reset',
  'connection error',
  'econnreset',
  'etimedout',
];

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.includes(n));
}

/** 抓出文本里独立成段的三位数（"12429" 整段长度不为 3，会被过滤掉）。 */
function httpCodesIn(text: string): number[] {
  return (text.match(/\d+/g) ?? []).filter((token) => token.length === 3).map(Number);
}

/**
 * 把错误文本归类。优先级：永久性信号（上下文超限 / 4xx / 鉴权参数错误）
 * 压过临时性信号，避免对注定失败的请求做无谓重试。
 */
function classifyFailure(raw: string | null | undefined): FailureKind {
  const text = (raw ?? '').toLowerCase();
  const codes = httpCodesIn(text);

  if (includesAny(text, CONTEXT_MARKERS)) return 'context';
  if (codes.some((c) => c >= 400 && c <= 499 && c !== 408 && c !== 429)) return 'permanent';
  if (includesAny(text, PERMANENT_MARKERS)) return 'permanent';

  if (codes.some((c) => c === 408 || c === 429 || (c >= 500 && c <= 599))) return 'retryable';
  if (includesAny(text, TRANSIENT_MARKERS)) return 'retryable';

  // 认不出的错误当永久错误处理，不触发重试风暴。
  return 'permanent';
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
    return classifyFailure(content) === 'retryable';
  }
}
