/**
 * Prompt builder —— 核心拼装逻辑。
 *
 * 提供：
 *  - buildMessages：把 system prompt + 历史 + 当前用户消息组装成 MessageList
 *  - addAssistantMessage / addToolResult：在 executor 循环内追加消息
 * 历史窗口、microcompact 和 token 预算在 Session.toLLMHistoryWithStats() 里处理。
 */

import { toToolCallDict } from '../../adapters/outbound/llm/anthropic.js';
import type {
  AssistantMessage,
  ChatMessage,
  MessageList,
  SystemMessage,
  ToolMessage,
  UserMessage,
} from '../../domain/contracts/messages.js';
import type { LLMResponse } from '../../domain/contracts/providers.js';

export interface BuildMessagesInput {
  systemPrompt: string;
  history: MessageList;
  /** 当前用户消息（字符串或多模态 content blocks）。 */
  userMessage: string | Array<Record<string, unknown>>;
}

/**
 * 构造完整 message list：system 一定在最前面；history 用 LLM 风格的角色；
 * 末尾追加当前用户消息。
 */
export function buildMessages(input: BuildMessagesInput): MessageList {
  const sys: SystemMessage = { role: 'system', content: input.systemPrompt };
  const user: UserMessage = { role: 'user', content: input.userMessage };
  return [sys, ...input.history, user];
}

/**
 * 把 LLM response 追加为一条 assistant 消息。
 * Anthropic 的 thinking_blocks 也一并保留 —— 下一轮把它们传回模型，
 * 模型才能延续 thinking 状态。
 */
export function addAssistantMessage(
  messages: MessageList,
  response: LLMResponse,
): AssistantMessage {
  const msg: AssistantMessage = {
    role: 'assistant',
    content: response.content ?? '',
  };
  if (response.tool_calls.length > 0) {
    msg.tool_calls = response.tool_calls.map(toToolCallDict);
  }
  if (response.reasoning_content) msg.reasoning_content = response.reasoning_content;
  if (response.thinking_blocks) msg.thinking_blocks = response.thinking_blocks;
  messages.push(msg);
  return msg;
}

export function addToolResult(
  messages: MessageList,
  toolCallId: string,
  toolName: string,
  content: string,
): ToolMessage {
  const msg: ToolMessage = {
    role: 'tool',
    tool_call_id: toolCallId,
    name: toolName,
    content,
  };
  messages.push(msg);
  return msg;
}

export function lastUserContent(messages: MessageList): string | null {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i] as ChatMessage;
    if (m.role === 'user') {
      return typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    }
  }
  return null;
}
