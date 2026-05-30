import * as Sentry from '@sentry/nextjs';
import type { Redis } from 'ioredis';

const STREAM_KEY = 'lumen:flow:tasks';

export class StreamPublisher {
  constructor(private redis: Redis) {}

  async publish(channelId: string, payload: string): Promise<string> {
    // 把当前活跃 span（ws.flow.receive）的 trace 上下文写进 stream fields，
    // engine XREADGROUP 后用它 continueTrace，把 Flow B 串成一条 trace。
    const td = Sentry.getTraceData();
    const messageId = await this.redis.xadd(
      STREAM_KEY,
      '*',
      'channelId',
      channelId,
      'payload',
      payload,
      'sentryTrace',
      td['sentry-trace'] ?? '',
      'baggage',
      td.baggage ?? '',
    );
    return messageId!;
  }
}
