import { getRedisClient } from '@lumen/db';
import { ClientMessageSchema, type ClientRunMessage } from '@lumen/shared/protocols';
import * as Sentry from '@sentry/nextjs';
import { nanoid } from 'nanoid';
import type { WebSocket } from 'ws';

import { getStudioServerConfig } from '../config';
import { getProjectRepository } from '../db';
import { logger } from '../logger';
import type { FlowAuthContext } from './auth';
import { EventSubscriber } from './event-subscriber';
import { StreamPublisher } from './stream-publisher';

type LiveSocket = WebSocket & { isAlive?: boolean };

const connections = new Map<string, LiveSocket>();
let publisher: StreamPublisher | null = null;
let subscriber: EventSubscriber | null = null;
let initialized = false;
let heartbeatTimer: NodeJS.Timeout | null = null;

const HEARTBEAT_INTERVAL_MS = 30_000;
// Bound the per-connection runId memory: each Set entry is small but on a
// long-lived ws (Agent canvas open for hours) the count grows unbounded with
// every Run click. 256 covers any realistic burst, beyond which we evict in
// FIFO order. Used only to validate cancel ownership, so eviction is safe.
const MAX_RUN_IDS_PER_CONN = 256;
// Authorising every run message hits Mongo. Within a single ws connection the
// owning user does not change, and project ownership rarely flips, so cache
// the boolean per connection with a short TTL to absorb burst-run scenarios
// without losing the security check entirely.
const PROJECT_AUTH_TTL_MS = 30_000;

type AuthorizedRunMessage = ClientRunMessage & {
  action: 'run';
  runId: string;
  projectId: string;
  workflowId: string;
  userId: string;
};

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

  // Detect half-open connections (mobile NAT / suspended laptops / CDN drop)
  // that never fire `close`. Without this, `connections` and the per-conn
  // runIds Set leak forever, and engine events keep being routed to nobody.
  heartbeatTimer = setInterval(() => {
    for (const [connId, socket] of connections) {
      if (socket.isAlive === false) {
        try {
          socket.terminate();
        } catch {
          // ignore
        }
        connections.delete(connId);
        continue;
      }
      socket.isAlive = false;
      try {
        socket.ping();
      } catch {
        // ignore — terminate on next pass if still wedged
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  if (typeof heartbeatTimer.unref === 'function') heartbeatTimer.unref();

  logger.info('flow gateway initialized');
}

export function handleFlowConnection(ws: WebSocket, auth: FlowAuthContext): void {
  const connId = nanoid(12);
  const runIds = new Set<string>();
  const liveSocket = ws as LiveSocket;
  liveSocket.isAlive = true;
  connections.set(connId, liveSocket);

  // Cache `projectRepository.exists(...)` results per connection. Same
  // (userId, projectId) is hit on every run; the check is a Mongo round-trip
  // that adds ~5-30ms to each Run click on a hot canvas.
  const projectAuthCache = new Map<string, { ok: boolean; expiresAt: number }>();

  liveSocket.on('pong', () => {
    liveSocket.isAlive = true;
  });

  ws.on('message', async (raw) => {
    try {
      const data = JSON.parse(raw.toString());
      const message = ClientMessageSchema.parse(data);

      if (!publisher) {
        ws.send(JSON.stringify({ event: 'node:error', nodeId: '', error: 'engine unavailable' }));
        return;
      }

      if (message.action === 'cancel') {
        if (!runIds.has(message.runId)) {
          ws.send(
            JSON.stringify({
              event: 'node:error',
              nodeId: '',
              error: 'run does not belong to this connection',
            }),
          );
          return;
        }

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

      const trustedMessage = await authorizeRunMessage(message, auth, projectAuthCache);
      // Cap the per-connection runId set in FIFO order. Long-lived sessions
      // (Agent canvas open for hours) used to accumulate every Run forever.
      if (runIds.size >= MAX_RUN_IDS_PER_CONN) {
        const oldest = runIds.values().next().value;
        if (oldest) runIds.delete(oldest);
      }
      runIds.add(trustedMessage.runId);
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
                run_id: trustedMessage.runId,
                project_id: trustedMessage.projectId,
                user_id: auth.userId,
                node_count: trustedMessage.nodeIds?.length ?? trustedMessage.nodes.length,
              },
            },
            () => publisher!.publish(channelId, JSON.stringify(trustedMessage)),
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

async function authorizeRunMessage(
  message: ClientRunMessage,
  auth: FlowAuthContext,
  cache: Map<string, { ok: boolean; expiresAt: number }>,
): Promise<AuthorizedRunMessage> {
  const runId = message.runId?.trim();
  if (!runId) {
    throw new Error('runId is required');
  }

  const projectId = message.projectId?.trim();
  if (!projectId) {
    throw new Error('projectId is required');
  }

  const cached = cache.get(projectId);
  const now = Date.now();
  let ownsProject: boolean;
  if (cached && cached.expiresAt > now) {
    ownsProject = cached.ok;
  } else {
    const projectRepository = await getProjectRepository();
    ownsProject = await projectRepository.exists(auth.userId, projectId);
    cache.set(projectId, { ok: ownsProject, expiresAt: now + PROJECT_AUTH_TTL_MS });
  }
  if (!ownsProject) {
    throw new Error('project not found');
  }

  return {
    ...message,
    action: 'run',
    runId,
    projectId,
    workflowId: projectId,
    userId: auth.userId,
  };
}

export async function stopFlowGateway(): Promise<void> {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
  if (subscriber) await subscriber.stop();
  for (const socket of connections.values()) {
    try {
      socket.terminate();
    } catch {
      // ignore
    }
  }
  connections.clear();
}
