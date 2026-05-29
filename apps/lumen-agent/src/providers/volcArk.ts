/**
 * VolcArk provider —— 火山方舟（豆包）。
 *
 * 协议完全兼容 OpenAI Chat Completions，所以直接用 openai SDK + 自定义 baseURL。
 * 流式 chunk 里 tool_call 是分片到达的，需要按 index 累积 arguments 字符串，
 * 最后 JSON.parse。
 */

import { HttpsProxyAgent } from 'https-proxy-agent';
import OpenAI from 'openai';

import { logger } from '../observability/logger.js';
import type { ChatMessage } from '../schemas/messages.js';
import type { ToolCallRequest } from '../schemas/providers.js';

import { type ChatOptions, LLMProvider, type LLMStreamChunk, type ToolDefinition } from './base.js';

interface OpenAIProviderOpts {
  apiKey: string;
  apiBase?: string;
  defaultModel?: string;
}

function toOpenAIMessages(
  messages: ChatMessage[],
): OpenAI.Chat.Completions.ChatCompletionMessageParam[] {
  const out: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      out.push({
        role: 'system',
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      });
    } else if (m.role === 'user') {
      // 多模态：content 数组直接透传（OpenAI 同样支持 text/image_url）
      out.push({
        role: 'user',
        content: m.content as OpenAI.Chat.Completions.ChatCompletionContentPart[] | string,
      });
    } else if (m.role === 'assistant') {
      const param: OpenAI.Chat.Completions.ChatCompletionAssistantMessageParam = {
        role: 'assistant',
        content: m.content,
      };
      if (m.tool_calls && m.tool_calls.length > 0) {
        param.tool_calls = m.tool_calls.map((tc) => ({
          id: tc.id,
          type: 'function',
          function: { name: tc.function.name, arguments: tc.function.arguments },
        }));
      }
      out.push(param);
    } else if (m.role === 'tool') {
      out.push({ role: 'tool', tool_call_id: m.tool_call_id, content: m.content });
    }
  }
  return out;
}

function convertTools(
  tools: ToolDefinition[] | undefined,
): OpenAI.Chat.Completions.ChatCompletionTool[] | undefined {
  if (!tools || tools.length === 0) return undefined;
  return tools.map((t) => ({
    type: 'function',
    function: {
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    },
  }));
}

abstract class OpenAICompatProvider extends LLMProvider {
  protected readonly client: OpenAI;
  protected readonly defaultModel: string;

  constructor(opts: OpenAIProviderOpts) {
    super({ apiKey: opts.apiKey, apiBase: opts.apiBase });
    // OpenAI v4 SDK 内部用 node-fetch，不读 undici globalDispatcher。
    // 所以这里独立从 env 读一次 HTTPS_PROXY；服务器上不设这个变量
    // 就完全 no-op。
    const proxy =
      process.env.HTTPS_PROXY ??
      process.env.https_proxy ??
      process.env.HTTP_PROXY ??
      process.env.http_proxy;
    this.client = new OpenAI({
      apiKey: opts.apiKey,
      baseURL: opts.apiBase,
      httpAgent: proxy ? new HttpsProxyAgent(proxy) : undefined,
    });
    this.defaultModel = opts.defaultModel ?? 'gpt-4o';
  }

  override getDefaultModel(): string {
    return this.defaultModel;
  }

  override async *chatStream(opts: ChatOptions): AsyncGenerator<LLMStreamChunk, void, unknown> {
    const model = opts.model ?? this.getDefaultModel();
    const messages = toOpenAIMessages(opts.messages);
    const tools = convertTools(opts.tools);

    const params: OpenAI.Chat.Completions.ChatCompletionCreateParamsStreaming = {
      model,
      messages,
      tools,
      tool_choice:
        opts.toolChoice === 'auto'
          ? 'auto'
          : opts.toolChoice === 'required'
            ? 'required'
            : opts.toolChoice
              ? { type: 'function', function: { name: opts.toolChoice.function.name } }
              : undefined,
      max_tokens: opts.maxTokens ?? this.generation.maxTokens,
      temperature: opts.temperature ?? this.generation.temperature ?? undefined,
      stream: true,
      stream_options: { include_usage: true },
    };

    const stream = await this.client.chat.completions.create(params);

    /** index → 累积中的 tool call */
    const partialToolCalls = new Map<number, { id: string; name: string; argumentsAcc: string }>();
    let lastFinishReason: string | undefined;
    let lastUsage: Record<string, number> | undefined;

    try {
      for await (const chunk of stream) {
        const choice = chunk.choices?.[0];
        if (!choice) {
          if (chunk.usage) {
            lastUsage = {
              prompt_tokens: chunk.usage.prompt_tokens ?? 0,
              completion_tokens: chunk.usage.completion_tokens ?? 0,
              total_tokens: chunk.usage.total_tokens ?? 0,
            };
          }
          continue;
        }
        const delta = choice.delta;

        if (delta?.content) {
          yield { textDelta: delta.content };
        }
        // 部分国产模型把推理放在 reasoning_content
        const reasoning = (delta as { reasoning_content?: string })?.reasoning_content;
        if (reasoning) yield { thinkingDelta: reasoning };

        if (delta?.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index;
            if (idx == null) continue;
            const cur = partialToolCalls.get(idx) ?? { id: '', name: '', argumentsAcc: '' };
            if (tc.id) cur.id = tc.id;
            if (tc.function?.name) cur.name = tc.function.name;
            if (tc.function?.arguments) cur.argumentsAcc += tc.function.arguments;
            partialToolCalls.set(idx, cur);
          }
        }

        if (choice.finish_reason) {
          lastFinishReason = choice.finish_reason;
        }
      }

      const completed: ToolCallRequest[] = [];
      for (const [, tc] of [...partialToolCalls.entries()].sort((a, b) => a[0] - b[0])) {
        let parsed: Record<string, unknown> = {};
        if (tc.argumentsAcc) {
          try {
            parsed = JSON.parse(tc.argumentsAcc) as Record<string, unknown>;
          } catch (e) {
            logger.warn(
              { err: e, raw: tc.argumentsAcc.slice(0, 200) },
              'tool_call arguments JSON parse 失败',
            );
            parsed = { _raw: tc.argumentsAcc };
          }
        }
        completed.push({ id: tc.id, name: tc.name, arguments: parsed });
      }

      yield {
        completedToolCalls: completed.length > 0 ? completed : undefined,
        finishReason: lastFinishReason,
        usage: lastUsage,
      };
    } catch (err) {
      logger.error({ err }, 'OpenAI-compat stream 异常');
      throw err;
    }
  }
}

export class VolcArkProvider extends OpenAICompatProvider {
  constructor(opts: { apiKey: string; apiBase?: string; defaultEndpoint?: string }) {
    super({
      apiKey: opts.apiKey,
      apiBase: opts.apiBase ?? 'https://ark.cn-beijing.volces.com/api/v3',
      defaultModel: opts.defaultEndpoint ?? '',
    });
  }
}

export class OpenAIProvider extends OpenAICompatProvider {
  constructor(opts: { apiKey: string; apiBase?: string; defaultModel?: string }) {
    super({
      apiKey: opts.apiKey,
      apiBase: opts.apiBase,
      defaultModel: opts.defaultModel ?? 'gpt-4o',
    });
  }
}
