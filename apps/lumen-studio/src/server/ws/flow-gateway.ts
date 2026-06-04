import { getRedisClient } from '@lumen/db';
import { ClientMessageSchema } from '@lumen/shared/protocols';
import * as Sentry from '@sentry/nextjs';
import { nanoid } from 'nanoid';
import type { WebSocket } from 'ws';

import { getStudioServerConfig } from '../config';
import { logger } from '../logger';
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
    logger.warn('REDIS_URL 未配置，flow gateway 不启用');
    return;
  }

  publisher = new StreamPublisher(redis);
  subscriber = new EventSubscriber(connections);
  subscriber.start();
  logger.info('flow gateway initialized');
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

      if (message.action === 'cancel') {
        await publisher.cancelRun(message.runId, message.reason);
        ws.send(
          JSON.stringify({
            event: 'flow:cancel',
            runId: message.runId,
            reason: message.reason ?? 'cancelled by user',
          }),
        );
        return;
      }

      const channelId = `flow:events:${connId}`;

      // 浏览器把 trace 注入在 message.trace 里；这里续接它，开一个
      // ws.flow.receive span，publish 时 StreamPublisher 会把这个 span 的
      // trace 写进 stream fields 传给 engine。
      await Sentry.continueTrace(
        {
          sentryTrace: message.trace?.sentryTrace ?? undefined,
          baggage: message.trace?.baggage ?? undefined,
        },
        () =>
          Sentry.startSpan(
            {
              name: 'ws.flow.receive',
              op: 'websocket.receive',
              attributes: {
                conn_id: connId,
                run_id: message.runId,
                project_id: message.projectId,
                node_count: message.nodeIds?.length ?? message.nodes.length,
              },
            },
            () => publisher!.publish(channelId, JSON.stringify(message)),
          ),
      );
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      logger.error({ err, conn_id: connId }, 'ws flow message failed');
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
