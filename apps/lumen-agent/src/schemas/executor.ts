/**
 * Executor 输出契约。
 */

import type { MessageList } from './messages.js';

export interface ToolTiming {
  call_count: number;
  total_ms: number;
}

export interface ExecutorResult {
  content: string;
  tools_used: string[];
  tool_timings: Record<string, ToolTiming>;
  iterations: number;
  finish_reason: string;
  messages: MessageList;
  terminal_error?: Record<string, unknown> | null;
  thinking_blocks?: Array<Record<string, unknown>> | null;
  reasoning_content?: string | null;
  usage?: Record<string, number>;
}
