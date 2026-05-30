import Redis from 'ioredis';
import type { WebSocket } from 'ws';

import { getStudioServerConfig } from '../config';
import { logger } from '../logger';

type ConnectionMap = Map<string, WebSocket>;

export class EventSubscriber {
  private subscriber: Redis | null = null;
  constructor(private connections: ConnectionMap) {}

  start(): void {
    const cfg = getStudioServerConfig();
    if (!cfg.REDIS_URL) {
      logger.warn('REDIS_URL 未配置，flow event subscriber 不启动');
      return;
    }

    this.subscriber = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null });
    this.subscriber.on('error', (err) => {
      logger.error({ err }, 'event subscriber redis error');
    });

    this.subscriber.on('pmessage', (_pattern, channel, message) => {
      const connId = channel.replace('flow:events:', '');
      const ws = this.connections.get(connId);
      if (ws && ws.readyState === 1) {
        ws.send(message);
      }
    });

    this.subscriber.psubscribe('flow:events:*');
  }

  async stop(): Promise<void> {
    if (this.subscriber) {
      await this.subscriber.quit();
      this.subscriber = null;
    }
  }
}
