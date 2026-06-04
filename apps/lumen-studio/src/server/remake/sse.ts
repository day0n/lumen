import 'server-only';

import Redis from 'ioredis';

import { getStudioServerConfig } from '../config';
import { logger } from '../logger';
import { fetchEventLog, jobEventChannel } from './dispatch';

/**
 * 爆款复刻 —— SSE 端点。
 *
 * 工作流程：
 * 1. 浏览器打开 EventSource('/api/remake/jobs/:id/stream?lastEventId=...')
 * 2. 服务端创建独立 Redis subscriber，订阅 lumen:remake:events:<jobId>
 * 3. 先用 lastEventId（Stream id）从 XRANGE 回放历史事件
 * 4. 再把实时 PubSub 消息推给客户端
 * 5. 客户端断开 → 销毁 subscriber
 *
 * 跨设备 / 刷新 / 切 tab 都能无损接上：lastEventId 由浏览器 EventSource 自动维护。
 */

export interface OpenSseStreamOptions {
  jobId: string;
  /** EventSource 自动带的 Last-Event-ID header，断线重连用 */
  lastEventId?: string;
  signal: AbortSignal;
}

export function openRemakeSseStream(options: OpenSseStreamOptions): Response {
  const cfg = getStudioServerConfig();
  if (!cfg.REDIS_URL) {
    return new Response('redis unavailable', { status: 503 });
  }
  const encoder = new TextEncoder();
  let subscriber: Redis | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const send = (id: string, data: string) => {
        controller.enqueue(encoder.encode(`id: ${id}\ndata: ${data}\n\n`));
      };
      const sendComment = (text: string) => {
        controller.enqueue(encoder.encode(`: ${text}\n\n`));
      };

      // 1. 回放历史
      try {
        const replay = await fetchEventLog(options.jobId, options.lastEventId ?? '0');
        for (const item of replay) {
          send(item.id, JSON.stringify(item.event));
        }
      } catch (error) {
        logger.warn({ err: error, jobId: options.jobId }, 'sse replay failed');
      }
      sendComment('connected');

      // 2. 实时订阅
      subscriber = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
      subscriber.on('error', (err) => {
        logger.warn({ err, jobId: options.jobId }, 'sse subscriber error');
      });

      const channel = jobEventChannel(options.jobId);
      subscriber.on('message', (_channel, message) => {
        // 给客户端的 id 用时间戳 — Redis Pub/Sub 没有原生 id，前端断线重连只依赖
        // log Stream 的 id（已在第 1 步回放阶段对齐），实时段的 id 仅作占位即可。
        const id = `live-${Date.now()}`;
        send(id, message);
      });
      try {
        await subscriber.subscribe(channel);
      } catch (error) {
        logger.warn({ err: error, jobId: options.jobId }, 'sse subscribe failed');
      }

      // 3. 心跳保活
      const heartbeat = setInterval(() => {
        sendComment('keepalive');
      }, 15_000);

      const cleanup = () => {
        clearInterval(heartbeat);
        subscriber?.quit().catch(() => undefined);
        subscriber = null;
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      options.signal.addEventListener('abort', cleanup, { once: true });
    },
    cancel() {
      subscriber?.quit().catch(() => undefined);
      subscriber = null;
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
