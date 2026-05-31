/**
 * Vertex AI Gemini provider —— 通过 Vertex REST 流式接口对接 Gemini。
 *
 *   - 部分仅在 global 端点提供的模型路由到 location=global，其余沿用配置的 location
 *   - 角色映射：system 提到顶层 system_instruction；user 原样；
 *     assistant → "model"；tool → "user" 下的 functionResponse part
 *   - 工具调用：从响应 part.functionCall 收集为 ToolCallRequest
 *   - 流式：调用 :streamGenerateContent?alt=sse，逐个 candidate 解析 SSE
 *
 * 暂不开启 reasoning/signature 的完整往返（留待后续）；当前普通对话路径不需要，
 * 因此默认把 thinking 预算压到 0。
 */

import type { ChatMessage, MessageList } from '../../../domain/contracts/messages.js';
import type { ToolCallRequest } from '../../../domain/contracts/providers.js';
import { GoogleTokenCache, parseServiceAccount } from '../../../platform/googleAuth.js';
import { logger } from '../../../platform/logger.js';

import { type ChatOptions, LLMProvider, type LLMStreamChunk, type ToolDefinition } from './base.js';

const VERTEX_MODEL_PREFIX = 'vertex_gemini/';

// 这些模型目前只在 global 端点可用；命中其一或带 preview 标记的，都走 global。
const GLOBAL_ONLY_MODELS: readonly string[] = [
  'gemini-3.5-flash',
  'gemini-3-flash-preview',
  'gemini-3.1-pro-preview',
  'gemini-3.1-flash-lite-preview',
  'gemini-3.1-flash-image-preview',
];

function needsGlobalLocation(model: string): boolean {
  const m = model.toLowerCase();
  return GLOBAL_ONLY_MODELS.includes(model) || m.includes('preview');
}

function unqualifyModel(model: string): string {
  return model.startsWith(VERTEX_MODEL_PREFIX) ? model.slice(VERTEX_MODEL_PREFIX.length) : model;
}

// 内部 thinking-block 标签（仅本 provider 自用，用于把 Gemini 的签名/思考往返存档）。
const BLOCK_REASONING = 'vertex_reasoning_trace';
const BLOCK_CALL_SIGNATURE = 'vertex_call_signature';

interface GeminiPart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  functionCall?: { name: string; args?: Record<string, unknown> };
  functionResponse?: { name: string; response: Record<string, unknown> };
}

interface GeminiContent {
  role: 'user' | 'model';
  parts: GeminiPart[];
}

interface GeminiUsageMetadata {
  promptTokenCount?: number;
  candidatesTokenCount?: number;
  thoughtsTokenCount?: number;
  cachedContentTokenCount?: number;
  toolUsePromptTokenCount?: number;
  totalTokenCount?: number;
}

interface GeminiCandidate {
  content?: GeminiContent;
  finishReason?: string;
}

interface GeminiStreamChunk {
  candidates?: GeminiCandidate[];
  usageMetadata?: GeminiUsageMetadata;
}

function messagesToContents(messages: ChatMessage[]): {
  contents: GeminiContent[];
  systemInstruction: string | null;
} {
  let systemInstruction: string | null = null;
  const contents: GeminiContent[] = [];

  for (const msg of messages) {
    const { role, content } = msg as { role: string; content: unknown };

    if (role === 'system') {
      const text =
        typeof content === 'string'
          ? content
          : Array.isArray(content)
            ? content
                .filter((p) => (p as { type?: string }).type === 'text')
                .map((p) => (p as { text: string }).text)
                .join('\n')
            : '';
      systemInstruction = (systemInstruction ? `${systemInstruction}\n` : '') + text;
      continue;
    }

    if (role === 'tool') {
      const m = msg as { tool_call_id: string; name: string; content: string };
      let response: Record<string, unknown>;
      try {
        const parsed = JSON.parse(m.content);
        response =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { result: parsed };
      } catch {
        response = { result: m.content };
      }
      const part: GeminiPart = {
        functionResponse: { name: m.name, response },
      };
      // tool 在 Gemini 里以 user role 进 contents
      mergeOrAppend(contents, 'user', [part]);
      continue;
    }

    const geminiRole: 'user' | 'model' = role === 'assistant' ? 'model' : 'user';
    const parts: GeminiPart[] = [];

    if (typeof content === 'string') {
      if (content) parts.push({ text: content });
    } else if (Array.isArray(content)) {
      for (const p of content) {
        const obj = p as { type?: string; text?: string };
        if (obj.type === 'text' && typeof obj.text === 'string') {
          parts.push({ text: obj.text });
        }
      }
    }

    if (role === 'assistant') {
      const tcs = (
        msg as { tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> }
      ).tool_calls;
      if (tcs) {
        // 从 thinking_blocks 拿到 {tool_name -> thoughtSignature(b64)} 映射，回灌到 functionCall part
        // Gemini 3.x 在带工具的多轮对话里强制要求 functionCall 的 thoughtSignature 必须原样回传。
        const tb = (msg as { thinking_blocks?: Array<Record<string, unknown>> }).thinking_blocks;
        const sigMap = new Map<string, string>();
        if (tb) {
          for (const block of tb) {
            if (block.type === BLOCK_CALL_SIGNATURE) {
              const name = String(block.name ?? '');
              const sig = String(block.thought_signature ?? '');
              if (name && sig) sigMap.set(name, sig);
            }
          }
        }
        for (const tc of tcs) {
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments) as Record<string, unknown>;
          } catch {
            args = {};
          }
          const part: GeminiPart = { functionCall: { name: tc.function.name, args } };
          const sig = sigMap.get(tc.function.name);
          if (sig) part.thoughtSignature = sig;
          parts.push(part);
        }
      }
    }

    if (parts.length > 0) {
      mergeOrAppend(contents, geminiRole, parts);
    }
  }

  return { contents, systemInstruction };
}

function mergeOrAppend(
  contents: GeminiContent[],
  role: 'user' | 'model',
  parts: GeminiPart[],
): void {
  const last = contents[contents.length - 1];
  if (last && last.role === role) {
    last.parts.push(...parts);
  } else {
    contents.push({ role, parts });
  }
}

function toolsToGenai(
  tools: ToolDefinition[],
): Array<{ functionDeclarations: Array<Record<string, unknown>> }> {
  return [
    {
      functionDeclarations: tools.map((t) => ({
        name: t.function.name,
        description: t.function.description,
        parameters: t.function.parameters,
      })),
    },
  ];
}

function toOpenAIUsage(u: GeminiUsageMetadata | undefined): Record<string, number> | undefined {
  if (!u) return undefined;

  const cached = u.cachedContentTokenCount ?? 0;
  // Gemini 把 cache 命中算进 promptTokenCount，这里扣掉以贴近 OpenAI 的"未命中输入"语义，
  // 再把工具调用提示的 token 计入输入侧。
  const billedInput =
    Math.max(0, (u.promptTokenCount ?? 0) - cached) + (u.toolUsePromptTokenCount ?? 0);
  const output = (u.candidatesTokenCount ?? 0) + (u.thoughtsTokenCount ?? 0);

  const usage: Record<string, number> = {
    prompt_tokens: billedInput,
    completion_tokens: output,
    total_tokens: u.totalTokenCount ?? (u.promptTokenCount ?? 0) + output,
  };
  if (cached > 0) usage.cache_read_input_tokens = cached;
  return usage;
}

export interface VertexGeminiProviderOpts {
  ocJsonB64: string;
  project?: string;
  location?: string;
  defaultModel?: string;
}

export class VertexGeminiProvider extends LLMProvider {
  private readonly tokenCache: GoogleTokenCache;
  private readonly project: string;
  private readonly location: string;
  private readonly defaultModel: string;

  constructor(opts: VertexGeminiProviderOpts) {
    super();
    const sa = parseServiceAccount(opts.ocJsonB64);
    this.tokenCache = new GoogleTokenCache(sa);
    this.project = opts.project || sa.project_id;
    this.location = opts.location ?? 'us-central1';
    this.defaultModel = opts.defaultModel ?? 'gemini-2.0-flash';
    this.generation.maxTokens = 8192;
    this.generation.temperature = 1.0;
  }

  override getDefaultModel(): string {
    return this.defaultModel;
  }

  override async *chatStream(opts: ChatOptions): AsyncGenerator<LLMStreamChunk, void, unknown> {
    const model = unqualifyModel(opts.model ?? this.defaultModel);
    const location = needsGlobalLocation(model) ? 'global' : this.location;
    const url =
      `https://aiplatform.googleapis.com/v1/projects/${this.project}/locations/${location}/` +
      `publishers/google/models/${model}:streamGenerateContent?alt=sse`;

    const { contents, systemInstruction } = messagesToContents(opts.messages);

    const body: Record<string, unknown> = {
      contents,
      generationConfig: {
        maxOutputTokens: opts.maxTokens ?? this.generation.maxTokens,
        temperature: opts.temperature ?? this.generation.temperature ?? undefined,
        // 第一阶段不开 thinking：避开 Gemini 3.x 在带工具调用时对 thought_signature 回传的强制要求
        thinkingConfig: { thinkingBudget: 0 },
      },
    };
    if (systemInstruction) {
      body.systemInstruction = { parts: [{ text: systemInstruction }] };
    }
    if (opts.tools && opts.tools.length > 0) {
      body.tools = toolsToGenai(opts.tools);
    }
    if (opts.toolChoice === 'required') {
      body.toolConfig = { functionCallingConfig: { mode: 'ANY' } };
    }

    const token = await this.tokenCache.getToken();
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });
    if (!res.ok || !res.body) {
      const text = await res.text();
      throw new Error(`Vertex Gemini stream HTTP ${res.status}: ${text.slice(0, 500)}`);
    }

    const accumulatedToolCalls: ToolCallRequest[] = [];
    const accumulatedThinkingBlocks: Array<Record<string, unknown>> = [];
    let lastUsage: Record<string, number> | undefined;
    let lastFinish: string | undefined;

    const decoder = new TextDecoder();
    const reader = res.body.getReader();
    let buf = '';

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        // SSE event 分隔符兼容 \r\n\r\n（Vertex 实际返回）和 \n\n
        while (true) {
          const idxCRLF = buf.indexOf('\r\n\r\n');
          const idxLF = buf.indexOf('\n\n');
          let nl = -1;
          let sep = 0;
          if (idxCRLF !== -1 && (idxLF === -1 || idxCRLF < idxLF)) {
            nl = idxCRLF;
            sep = 4;
          } else if (idxLF !== -1) {
            nl = idxLF;
            sep = 2;
          } else {
            break;
          }
          const evt = buf.slice(0, nl);
          buf = buf.slice(nl + sep);
          for (const line of evt.split(/\r?\n/)) {
            if (!line.startsWith('data:')) continue;
            const data = line.slice(5).trim();
            if (!data) continue;
            let payload: GeminiStreamChunk;
            try {
              payload = JSON.parse(data) as GeminiStreamChunk;
            } catch (e) {
              logger.warn({ err: e, data: data.slice(0, 200) }, 'Gemini SSE 解析失败');
              continue;
            }

            const usage = toOpenAIUsage(payload.usageMetadata);
            if (usage) lastUsage = usage;

            const candidate = payload.candidates?.[0];
            if (!candidate) continue;
            if (candidate.finishReason) lastFinish = candidate.finishReason;

            let textDelta = '';
            for (const part of candidate.content?.parts ?? []) {
              if (part.thought) {
                if (part.text) yield { thinkingDelta: part.text };
                if (part.thoughtSignature) {
                  accumulatedThinkingBlocks.push({
                    type: BLOCK_REASONING,
                    thinking: part.text ?? '',
                    thought_signature: part.thoughtSignature,
                  });
                }
                continue;
              }
              if (part.functionCall) {
                accumulatedToolCalls.push({
                  id: `call_${part.functionCall.name}`,
                  name: part.functionCall.name,
                  arguments: part.functionCall.args ?? {},
                });
                if (part.thoughtSignature) {
                  // Gemini 3.x: thoughtSignature 挂在 functionCall part 上，必须原样回传。
                  accumulatedThinkingBlocks.push({
                    type: BLOCK_CALL_SIGNATURE,
                    name: part.functionCall.name,
                    thought_signature: part.thoughtSignature,
                  });
                }
                continue;
              }
              if (part.text) textDelta += part.text;
            }
            if (textDelta) yield { textDelta };
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    yield {
      completedToolCalls: accumulatedToolCalls.length > 0 ? accumulatedToolCalls : undefined,
      finishReason: accumulatedToolCalls.length > 0 ? 'tool_calls' : (lastFinish ?? 'stop'),
      usage: lastUsage,
      thinkingBlocks: accumulatedThinkingBlocks.length > 0 ? accumulatedThinkingBlocks : undefined,
    };
  }
}
