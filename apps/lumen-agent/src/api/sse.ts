/**
 * 单个 SSE 写器 —— 把 AgentEvent 序列化成 `event: name\ndata: json\n\n`。
 *
 * Hono 的 `streamSSE` 已经能写 SSE，但我们直接拿 streamSSE.writeSSE 就够了，
 * 这里把转换逻辑独立出来便于测试。
 */

import type { SSEStreamingApi } from 'hono/streaming';

import type { AgentEvent } from '../core/events.js';

export async function writeEvent(stream: SSEStreamingApi, event: AgentEvent): Promise<void> {
  await stream.writeSSE({
    event: event.event,
    data: JSON.stringify(event.data),
  });
}

export function makeSSEEmitter(stream: SSEStreamingApi) {
  return async (event: AgentEvent): Promise<void> => {
    if (stream.aborted || stream.closed) return;
    await writeEvent(stream, event);
  };
}
