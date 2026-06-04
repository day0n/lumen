/**
 * InferenceLoop —— 驱动「LLM ↔ 工具」流式往返的迭代引擎。
 *
 * 每一轮（受 maxIterations 上限约束）依次：
 *   1. 发出 step 开始信号
 *   2. 以流式方式向 provider 取本轮回复，边收边把文本/思考增量与工具调用归集起来
 *   3. 把这条 assistant 消息（含其发起的工具调用）追加进消息列表
 *   4. 若本轮没有工具调用，说明已是最终答复，跳出循环
 *   5. 否则逐个执行工具，并把每个工具的结果回填为一条消息
 *   6. 发出 step 结束信号
 *
 * 全部可观测节点都经由 InferenceHooks 暴露；未提供的钩子静默跳过。
 */

import type { LLMProvider } from '../adapters/outbound/llm/base.js';
import type { ToolCatalog } from '../adapters/outbound/tools/registry.js';
import type { InferenceResult, ToolTiming } from '../domain/contracts/executor.js';
import type { MessageList } from '../domain/contracts/messages.js';
import type { LLMResponse, ToolCallRequest } from '../domain/contracts/providers.js';
import { isToolResult } from '../domain/contracts/tools.js';
import { logger } from '../platform/logger.js';
import { addAssistantMessage, addToolResult } from './prompt/builder.js';

// 单条工具结果回填进上下文前的字符上限，超出则尾部截断（纯调优值，非协议）。
const TOOL_OUTPUT_CHAR_BUDGET = 20_000;

const ERROR_CONTINUE_HINT =
  '\n\nHint: read the failure above first, then fix the arguments or switch to another route before retrying.';

export interface InferenceHooks {
  onStepStart?: (iteration: number) => Promise<void> | void;
  onStepEnd?: (iteration: number) => Promise<void> | void;
  onLLMStart?: (model: string, messages: MessageList) => Promise<void> | void;
  onLLMEnd?: (usage: Record<string, number>) => Promise<void> | void;
  onTextDelta?: (text: string) => Promise<void> | void;
  onThinkingDelta?: (text: string) => Promise<void> | void;
  onToolStart?: (
    toolName: string,
    toolCallId: string,
    args: Record<string, unknown>,
  ) => Promise<void> | void;
  onToolEnd?: (
    toolName: string,
    toolCallId: string,
    outputBytes: number,
    error: string | null,
    args: Record<string, unknown>,
    status: 'success' | 'error',
    durationMs: number,
    output: string,
    truncated: boolean,
  ) => Promise<void> | void;
  onToolEvent?: (
    toolName: string,
    event: { name: string; data: Record<string, unknown> },
    toolCallId: string,
  ) => Promise<void> | void;
}

export interface InferenceLoopOptions {
  provider: LLMProvider;
  model: string;
  tools: ToolCatalog;
  maxIterations?: number;
  toolResultMaxChars?: number;
  hooks?: InferenceHooks;
  hiddenTools?: Set<string>;
  /** 默认 max_tokens（每次 LLM 调用） */
  maxTokens?: number;
  temperature?: number | null;
}

export class InferenceLoop {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly tools: ToolCatalog;
  readonly maxIterations: number;
  readonly toolResultMaxChars: number;
  readonly hooks: InferenceHooks;
  readonly hiddenTools: Set<string>;
  readonly maxTokens: number | undefined;
  readonly temperature: number | null | undefined;

  constructor(opts: InferenceLoopOptions) {
    this.provider = opts.provider;
    this.model = opts.model;
    this.tools = opts.tools;
    this.maxIterations = opts.maxIterations ?? 40;
    this.toolResultMaxChars = opts.toolResultMaxChars ?? TOOL_OUTPUT_CHAR_BUDGET;
    this.hooks = opts.hooks ?? {};
    this.hiddenTools = opts.hiddenTools ?? new Set();
    this.maxTokens = opts.maxTokens;
    this.temperature = opts.temperature;
  }

  async run(messages: MessageList): Promise<InferenceResult> {
    let iteration = 0;
    let finalContent: string | null = null;
    let finishReason = 'stop';
    let terminalError: Record<string, unknown> | null = null;
    const toolsUsed: string[] = [];
    const toolTimings: Record<string, ToolTiming> = {};
    let aggregatedUsage: Record<string, number> = {};
    let lastReasoning: string | null = null;
    let lastThinkingBlocks: Array<Record<string, unknown>> | null = null;

    while (iteration < this.maxIterations) {
      iteration += 1;
      logger.info({ iteration, max: this.maxIterations, model: this.model }, 'Executor iteration');

      await this.hooks.onStepStart?.(iteration);
      await this.hooks.onLLMStart?.(this.model, messages);

      const response = await this.streamOnce(messages);
      lastReasoning = response.reasoning_content ?? null;
      lastThinkingBlocks = response.thinking_blocks ?? null;

      if (response.usage) aggregatedUsage = mergeUsage(aggregatedUsage, response.usage);
      await this.hooks.onLLMEnd?.(response.usage ?? {});

      // 顶层错误：把错误塞到 final content，break
      if (response.finish_reason === 'error') {
        finalContent = response.content ?? 'LLM error';
        finishReason = 'error';
        terminalError = { code: 'llm_error', message: finalContent };
        addAssistantMessage(messages, response);
        await this.hooks.onStepEnd?.(iteration);
        break;
      }

      addAssistantMessage(messages, response);

      if (response.tool_calls.length === 0) {
        finalContent = response.content ?? '';
        finishReason = response.finish_reason ?? 'stop';
        await this.hooks.onStepEnd?.(iteration);
        break;
      }

      // 执行 tool calls（顺序执行，避免 message ordering 复杂化）
      for (const tc of response.tool_calls) {
        await this.runToolCall(tc, messages, toolsUsed, toolTimings);
      }

      await this.hooks.onStepEnd?.(iteration);
    }

    if (finalContent === null) {
      finalContent = `Reached max iterations (${this.maxIterations}). Stopping.`;
      finishReason = 'max_iterations';
    }

    return {
      content: finalContent,
      tools_used: toolsUsed,
      tool_timings: toolTimings,
      iterations: iteration,
      finish_reason: finishReason,
      messages,
      terminal_error: terminalError,
      thinking_blocks: lastThinkingBlocks,
      reasoning_content: lastReasoning,
      usage: aggregatedUsage,
    };
  }

  // ── 单轮 streaming ──────────────────────────────────────────────

  private async streamOnce(messages: MessageList): Promise<LLMResponse> {
    const toolDefs = this.tools.getDefinitions({ exclude: this.hiddenTools });

    let content = '';
    let thinking = '';
    const toolCalls: ToolCallRequest[] = [];
    let finishReason = 'stop';
    let usage: Record<string, number> = {};
    let thinkingBlocks: Array<Record<string, unknown>> | null = null;
    let errored: string | null = null;

    for await (const chunk of this.provider.chatStreamWithRetry({
      messages,
      tools: toolDefs.length > 0 ? toolDefs : undefined,
      model: this.model,
      maxTokens: this.maxTokens,
      temperature: this.temperature ?? undefined,
    })) {
      if (chunk.textDelta) {
        content += chunk.textDelta;
        await this.hooks.onTextDelta?.(chunk.textDelta);
      }
      if (chunk.thinkingDelta) {
        thinking += chunk.thinkingDelta;
        await this.hooks.onThinkingDelta?.(chunk.thinkingDelta);
      }
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

  // ── 单个 tool 调用 ──────────────────────────────────────────────

  private async runToolCall(
    tc: ToolCallRequest,
    messages: MessageList,
    toolsUsed: string[],
    toolTimings: Record<string, ToolTiming>,
  ): Promise<void> {
    const { id: toolCallId, name: toolName, arguments: args } = tc;
    const start = performance.now();

    await this.hooks.onToolStart?.(toolName, toolCallId, args);

    let resultText: string;
    let toolError: string | null = null;
    let status: 'success' | 'error' = 'success';

    try {
      const tool = this.tools.get(toolName);
      const timeoutSec = tool?.timeoutSeconds ?? null;
      const result = timeoutSec
        ? await withTimeout(
            this.tools.execute(toolName, args, {
              onToolEvent: (ev) => this.hooks.onToolEvent?.(toolName, ev, toolCallId),
            }),
            timeoutSec * 1000,
            toolName,
          )
        : await this.tools.execute(toolName, args, {
            onToolEvent: (ev) => this.hooks.onToolEvent?.(toolName, ev, toolCallId),
          });

      if (isToolResult(result)) {
        for (const ev of result.events) {
          await this.hooks.onToolEvent?.(toolName, ev, toolCallId);
        }
        resultText = result.content;
      } else {
        resultText = result;
      }
      if (resultText.startsWith('Error')) {
        status = 'error';
        toolError = resultText;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err, tool: toolName }, 'Tool invocation failed');
      resultText = `Error executing ${toolName}: ${msg}${ERROR_CONTINUE_HINT}`;
      status = 'error';
      toolError = msg;
    }

    const rawResultText = resultText;
    let truncated = false;
    if (resultText.length > this.toolResultMaxChars) {
      const truncatedChars = resultText.length - this.toolResultMaxChars;
      resultText = `${resultText.slice(0, this.toolResultMaxChars)}\n\n[...truncated ${truncatedChars} chars]`;
      truncated = true;
    }

    addToolResult(messages, toolCallId, toolName, resultText);

    const durationMs = Math.round(performance.now() - start);
    toolsUsed.push(toolName);
    const t = toolTimings[toolName] ?? { call_count: 0, total_ms: 0 };
    t.call_count += 1;
    t.total_ms += durationMs;
    toolTimings[toolName] = t;

    await this.hooks.onToolEnd?.(
      toolName,
      toolCallId,
      Buffer.byteLength(rawResultText, 'utf8'),
      toolError,
      args,
      status,
      durationMs,
      rawResultText,
      truncated,
    );
  }
}

function mergeUsage(a: Record<string, number>, b: Record<string, number>): Record<string, number> {
  const out: Record<string, number> = { ...a };
  for (const [k, v] of Object.entries(b)) {
    out[k] = (out[k] ?? 0) + v;
  }
  return out;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Tool '${label}' timed out after ${ms}ms`));
    }, ms);
    p.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (e) => {
        clearTimeout(timer);
        reject(e);
      },
    );
  });
}
