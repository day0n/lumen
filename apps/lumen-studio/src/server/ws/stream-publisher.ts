import type { Redis } from 'ioredis';

const STREAM_KEY = 'lumen:flow:tasks';

export class StreamPublisher {
  constructor(private redis: Redis) {}

  async publish(channelId: string, payload: string): Promise<string> {
    const messageId = await this.redis.xadd(
      STREAM_KEY,
      '*',
      'channelId',
      channelId,
      'payload',
      payload,
    );
    return messageId!;
  }
}
