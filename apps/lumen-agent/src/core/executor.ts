/**
 * AgentExecutor —— LLM / tool 流式迭代引擎。
 *
 *   while iteration < maxIterations:
 *     [step.started]
 *     stream = provider.chatStreamWithRetry(messages, tools)
 *     for chunk in stream:
 *       textDelta → on_text_delta
 *       thinkingDelta → on_thinking_delta
 *       completedToolCalls → 累积
 *     append assistant message with tool_calls
 *     if no tool calls: break (最终答复)
 *     for each tool call:
 *       [tool.started]
 *       result = tool.execute(...)
 *       [tool.completed | tool.failed]
 *       append tool result message
 *     [step.completed]
 *
 * 所有可观测点通过 ExecutorHooks 注入（None = 静默跳过）。
 */

import { logger } from '../observability/logger.js';
import type { LLMProvider } from '../providers/base.js';
import type { ExecutorResult, ToolTiming } from '../schemas/executor.js';
import type { MessageList } from '../schemas/messages.js';
import type { LLMResponse, ToolCallRequest } from '../schemas/providers.js';
import { isToolResult } from '../schemas/tools.js';
import { addAssistantMessage, addToolResult } from './prompt/builder.js';
import type { ToolRegistry } from './tools/registry.js';

const DEFAULT_TOOL_RESULT_MAX_CHARS = 16_000;

const ERROR_CONTINUE_HINT = '\n\n[Analyze the error above and try a different approach.]';

export interface ExecutorHooks {
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
  ) => Promise<void> | void;
  onToolEvent?: (
    toolName: string,
    event: { name: string; data: Record<string, unknown> },
    toolCallId: string,
  ) => Promise<void> | void;
}

export interface ExecutorOptions {
  provider: LLMProvider;
  model: string;
  tools: ToolRegistry;
  maxIterations?: number;
  toolResultMaxChars?: number;
  hooks?: ExecutorHooks;
  hiddenTools?: Set<string>;
  /** 默认 max_tokens（每次 LLM 调用） */
  maxTokens?: number;
  temperature?: number | null;
}

export class AgentExecutor {
  readonly provider: LLMProvider;
  readonly model: string;
  readonly tools: ToolRegistry;
  readonly maxIterations: number;
  readonly toolResultMaxChars: number;
  readonly hooks: ExecutorHooks;
  readonly hiddenTools: Set<string>;
  readonly maxTokens: number | undefined;
  readonly temperature: number | null | undefined;

  constructor(opts: ExecutorOptions) {
    this.provider = opts.provider;
    this.model = opts.model;
    this.tools = opts.tools;
    this.maxIterations = opts.maxIterations ?? 40;
    this.toolResultMaxChars = opts.toolResultMaxChars ?? DEFAULT_TOOL_RESULT_MAX_CHARS;
    this.hooks = opts.hooks ?? {};
    this.hiddenTools = opts.hiddenTools ?? new Set();
    this.maxTokens = opts.maxTokens;
    this.temperature = opts.temperature;
  }

  async run(messages: MessageList): Promise<ExecutorResult> {
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

    if (resultText.length > this.toolResultMaxChars) {
      const truncated = resultText.length - this.toolResultMaxChars;
      resultText = `${resultText.slice(0, this.toolResultMaxChars)}\n\n[...truncated ${truncated} chars]`;
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
      Buffer.byteLength(resultText, 'utf8'),
      toolError,
      args,
      status,
      durationMs,
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
