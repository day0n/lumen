/**
 * LLM message types — TypeScript interfaces (zero runtime cost).
 * 这些类型流过 executor、prompt builder、provider、session。
 */

export interface ToolCallFunction {
  name: string;
  arguments: string; // JSON 字符串（OpenAI 格式）
  provider_specific_fields?: Record<string, unknown>;
}

export interface ToolCallDict {
  id: string;
  type: 'function';
  function: ToolCallFunction;
  provider_specific_fields?: Record<string, unknown>;
}

// ── 标准 LLM 消息（用于 provider 调用） ────────────────────────────

export interface SystemMessage {
  role: 'system';
  content: string | Array<Record<string, unknown>>;
}

export interface UserMessage {
  role: 'user';
  content: string | Array<Record<string, unknown>>;
}

export interface AssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: ToolCallDict[];
  reasoning_content?: string | null;
  thinking_blocks?: Array<Record<string, unknown>> | null;
}

export interface ToolMessage {
  role: 'tool';
  tool_call_id: string;
  name: string;
  content: string;
}

export type ChatMessage = SystemMessage | UserMessage | AssistantMessage | ToolMessage;
export type MessageList = ChatMessage[];

// ── 持久化用的 display 消息（不喂给 LLM） ──────────────────────────

export interface AssistantDisplayMessage {
  role: 'assistant';
  content: string;
  turn?: number;
  tool_hints?: string[];
  created_at?: string;
}

export interface ToolCallDisplayMessage {
  role: 'tool_call';
  content: string | null;
  turn?: number;
  tool_call_id: string;
  tool_name: string;
  tool_call: Record<string, unknown>;
  created_at?: string;
}

export interface ToolEventDisplayMessage {
  role: 'tool_event';
  content: string | null;
  turn?: number;
  tool_call_id: string;
  tool_name: string;
  event: string;
  event_data: Record<string, unknown>;
  created_at?: string;
}

export interface ToolResultDisplayMessage {
  role: 'tool_result';
  content: string | null;
  turn?: number;
  tool_call_id: string;
  tool_name: string;
  status: 'success' | 'error';
  error?: string | null;
  duration_ms?: number;
  output_size_bytes?: number;
  truncated?: boolean;
  created_at?: string;
}

export type StoredMessage =
  | ChatMessage
  | AssistantDisplayMessage
  | ToolCallDisplayMessage
  | ToolEventDisplayMessage
  | ToolResultDisplayMessage;

// ── 高频流式 payload ──────────────────────────────────────────────

export interface MessageDeltaData {
  content: string;
}

export interface ThinkingDeltaData {
  content: string;
}
