/**
 * Hono server —— 两步制 SSE 协议。
 *
 * 端点：
 *   POST /v1/agent/runs               创建 run，立刻返回 { run_id }
 *   GET  /v1/agent/runs/:id/events    SSE 拉事件流，支持 Last-Event-ID 续传
 *   POST /v1/agent/runs/:id/cancel    取消 run
 *   GET  /healthz                     健康检查
 *
 * 设计要点：
 *   1. POST /runs 立即返回，agent 在后台跑（fire-and-forget），事件全进 RunStore。
 *   2. GET /events 用 streamSSE，先 replay Last-Event-ID 之后的旧事件，再订阅新事件。
 *   3. RunStore 保留终态后 1h，断线 1h 内重连可继续看完整事件流，不会重复触发 agent。
 */

import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { nanoid } from 'nanoid';
import { z } from 'zod';

import type { AgentEvent } from '../core/events.js';
import type { AgentLoop } from '../core/loop.js';
import { logger } from '../observability/logger.js';

import type { AuthUser } from './auth.js';
import { clerkAuth } from './auth.js';
import { cors } from './cors.js';
import { RunStore } from './run-store.js';

type Env = { Variables: { authUser: AuthUser } };

const CreateRunSchema = z.object({
  session_id: z.string().min(1),
  message: z.union([z.string(), z.array(z.record(z.string(), z.unknown()))]),
  profile: z.string().default('main'),
  context: z.record(z.string(), z.unknown()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  client_request_id: z.string().optional(),
});

export interface ServerDeps {
  agentLoop: AgentLoop;
  corsOrigins: string[];
  clerkIssuer: string;
}

export function buildApp(deps: ServerDeps): Hono<Env> {
  const app = new Hono<Env>();
  const runStore = new RunStore();

  app.use('*', cors({ origins: deps.corsOrigins }));
  app.use('*', clerkAuth({ issuer: deps.clerkIssuer, skipPaths: ['/healthz'] }));

  app.get('/healthz', (c) => c.json({ ok: true, service: 'lumen-agent', ts: Date.now() }));

  // ── 1. 创建 run ──────────────────────────────────────────────────
  app.post('/v1/agent/runs', async (c) => {
    const json = await c.req.json().catch(() => ({}));
    const parsed = CreateRunSchema.safeParse(json);
    if (!parsed.success) {
      return c.json({ error: 'invalid_request', issues: parsed.error.issues }, 400);
    }
    const body = parsed.data;
    const runId = nanoid(16);
    const authUser = c.get('authUser') as AuthUser;

    runStore.create(runId);

    void deps.agentLoop
      .run(
        {
          sessionId: body.session_id,
          userId: authUser.userId,
          message: body.message,
          metadata: body.metadata,
        },
        body.profile,
        async (event: AgentEvent) => {
          if (runStore.isCancelled(runId) && event.event !== 'run.cancelled') {
            return;
          }
          runStore.publish(runId, event);
        },
        runId,
      )
      .catch((err) => {
        const message = err instanceof Error ? err.message : String(err);
        logger.error({ err, run_id: runId }, 'AgentLoop crashed outside event loop');
        runStore.publish(runId, {
          event: 'agent.failed',
          data: { error: message, code: 'internal_error' },
        });
        runStore.publish(runId, {
          event: 'run.failed',
          data: { run_id: runId, error: message },
        });
      });

    return c.json({ run_id: runId, session_id: body.session_id });
  });

  // ── 2. 订阅 run 事件流 ───────────────────────────────────────────
  app.get('/v1/agent/runs/:runId/events', async (c) => {
    const runId = c.req.param('runId');
    if (!runStore.has(runId)) {
      return c.json({ error: 'run_not_found' }, 404);
    }

    const lastEventId = c.req.header('Last-Event-ID') ?? c.req.query('last_event_id') ?? null;

    return streamSSE(c, async (stream) => {
      const subscription = runStore.subscribe(runId, lastEventId, async (entry) => {
        if (entry.event.event === '__terminal__') {
          await closeStream();
          return;
        }
        if (stream.aborted || stream.closed) return;
        await stream.writeSSE({
          id: entry.id,
          event: entry.event.event,
          data: JSON.stringify(entry.event.data),
        });
      });

      if (!subscription) {
        await stream.writeSSE({
          event: 'agent.failed',
          data: JSON.stringify({ error: 'run_not_found', code: 'run_not_found' }),
        });
        return;
      }

      let resolveClose: (() => void) | null = null;
      const closed = new Promise<void>((resolve) => {
        resolveClose = resolve;
      });

      const closeStream = async () => {
        if (resolveClose) {
          resolveClose();
          resolveClose = null;
        }
      };

      stream.onAbort(() => {
        subscription.unsubscribe();
        void closeStream();
      });

      // replay 旧事件
      for (const entry of subscription.replay) {
        if (stream.aborted || stream.closed) {
          subscription.unsubscribe();
          return;
        }
        await stream.writeSSE({
          id: entry.id,
          event: entry.event.event,
          data: JSON.stringify(entry.event.data),
        });
      }

      if (subscription.terminal) {
        return;
      }

      // 订阅期间：listener 写到 stream，关闭信号通过 closed Promise 传过来
      await closed;
      subscription.unsubscribe();
    });
  });

  // ── 3. 取消 run ──────────────────────────────────────────────────
  app.post('/v1/agent/runs/:runId/cancel', (c) => {
    const runId = c.req.param('runId');
    const ok = runStore.cancel(runId);
    if (!ok) return c.json({ error: 'run_not_found' }, 404);
    runStore.publish(runId, { event: 'agent.stopped', data: { run_id: runId } });
    runStore.publish(runId, { event: 'run.cancelled', data: { run_id: runId } });
    return c.json({ ok: true });
  });

  return app;
}
