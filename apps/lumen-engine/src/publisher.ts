import type { ServerEvent } from '@lumen/shared/protocols';
import type Redis from 'ioredis';
import { logger } from './utils/logger.js';

export class EventPublisher {
  constructor(private redis: Redis) {}

  async publish(channelId: string, event: ServerEvent): Promise<void> {
    const payload = JSON.stringify(event);
    await this.redis.publish(channelId, payload);
    logger.debug({ channelId, event: event.event }, 'published event');
  }
}
