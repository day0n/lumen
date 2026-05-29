import { getRedisClient } from '@lumen/db';
import { ClientMessageSchema } from '@lumen/shared/protocols';
import { nanoid } from 'nanoid';
import type { WebSocket } from 'ws';

import { getStudioServerConfig } from '../config';
import { EventSubscriber } from './event-subscriber';
import { StreamPublisher } from './stream-publisher';

const connections = new Map<string, WebSocket>();
let publisher: StreamPublisher | null = null;
let subscriber: EventSubscriber | null = null;
let initialized = false;

export function initFlowGateway(): void {
  if (initialized) return;
  initialized = true;

  const cfg = getStudioServerConfig();
  const redis = getRedisClient({ url: cfg.REDIS_URL });
  if (!redis) {
    console.warn('[ws] REDIS_URL 未配置，flow gateway 不启用');
    return;
  }

  publisher = new StreamPublisher(redis);
  subscriber = new EventSubscriber(connections);
  subscriber.start();
  console.log('[ws] flow gateway initialized');
}

export function handleFlowConnection(ws: WebSocket): void {
  const connId = nanoid(12);
  connections.set(connId, ws);

  ws.on('message', async (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      const message = ClientMessageSchema.parse(data);

      if (!publisher) {
        ws.send(JSON.stringify({ event: 'node:error', nodeId: '', error: 'engine unavailable' }));
        return;
      }

      const channelId = `flow:events:${connId}`;
      await publisher.publish(channelId, JSON.stringify(message));
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      ws.send(JSON.stringify({ event: 'node:error', nodeId: '', error }));
    }
  });

  ws.on('close', () => {
    connections.delete(connId);
  });

  ws.on('error', () => {
    connections.delete(connId);
  });
}

export async function stopFlowGateway(): Promise<void> {
  if (subscriber) await subscriber.stop();
  connections.clear();
}
