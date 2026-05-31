/**
 * RunStore —— 把每个 agent run 的事件序列缓存在内存里，按递增 id 编号。
 *
 * 协议：
 *   1. POST /v1/agent/runs            创建 run，后台跑 agent，立刻返回 run_id
 *   2. GET  /v1/agent/runs/:id/events SSE 拉事件，支持 Last-Event-ID 续传
 *
 * RunStore 不关心 SSE，只暴露 publish/subscribe + replay。
 *
 * 设计要点：
 *   - 事件 id 从 1 递增的字符串（fetchEventSource 用 Last-Event-ID 头透传）。
 *   - replay(lastId) 一次性返回 lastId 之后的所有事件；之后 subscribe 拿新的。
 *   - run 终态后保留 RUN_TTL_MS 时间方便重连；之后回收。
 *
 * 一阶段所有 run 都在单进程内存里，多副本部署需要换 Redis。
 */

import type { AgentEvent } from '../../../domain/events.js';
import { isTerminal } from '../../../domain/events.js';

const RUN_TTL_AFTER_TERMINAL_MS = 60 * 60 * 1000; // 1h

export interface StoredEvent {
  id: string;
  event: AgentEvent;
}

export type EventListener = (entry: StoredEvent) => void;

interface RunRecord {
  runId: string;
  ownerId: string;
  events: StoredEvent[];
  terminal: boolean;
  cancelled: boolean;
  listeners: Set<EventListener>;
  reapTimer?: NodeJS.Timeout;
  createdAt: number;
}

export class RunStore {
  private readonly runs = new Map<string, RunRecord>();

  create(runId: string, ownerId: string): void {
    if (this.runs.has(runId)) return;
    this.runs.set(runId, {
      runId,
      ownerId,
      events: [],
      terminal: false,
      cancelled: false,
      listeners: new Set(),
      createdAt: Date.now(),
    });
  }

  has(runId: string, ownerId?: string): boolean {
    const record = this.runs.get(runId);
    if (!record) return false;
    return !ownerId || record.ownerId === ownerId;
  }

  isCancelled(runId: string): boolean {
    return this.runs.get(runId)?.cancelled ?? false;
  }

  cancel(runId: string, ownerId?: string): boolean {
    const record = this.runs.get(runId);
    if (!record) return false;
    if (ownerId && record.ownerId !== ownerId) return false;
    record.cancelled = true;
    return true;
  }

  publish(runId: string, event: AgentEvent): StoredEvent {
    const record = this.runs.get(runId);
    if (!record) throw new Error(`Run not found: ${runId}`);

    const entry: StoredEvent = {
      id: String(record.events.length + 1),
      event,
    };
    record.events.push(entry);

    for (const listener of record.listeners) {
      try {
        listener(entry);
      } catch {
        /* listener errors must not stop publishing */
      }
    }

    if (isTerminal(event) || event.event === 'run:error') {
      this.markTerminal(record);
    }

    return entry;
  }

  /**
   * 拿到 lastEventId 之后的事件 + 订阅器。
   * 如果 run 已经终态且 replay 完毕，subscribe 立刻返回 unsubscribe（无新事件）。
   */
  subscribe(
    runId: string,
    lastEventId: string | null,
    listener: EventListener,
  ): { replay: StoredEvent[]; terminal: boolean; unsubscribe: () => void } | null {
    const record = this.runs.get(runId);
    if (!record) return null;

    const lastNum = Number.parseInt(lastEventId ?? '', 10);
    const replay = Number.isFinite(lastNum)
      ? record.events.filter((e) => Number.parseInt(e.id, 10) > lastNum)
      : record.events.slice();

    if (record.terminal) {
      return { replay, terminal: true, unsubscribe: () => {} };
    }

    record.listeners.add(listener);
    return {
      replay,
      terminal: false,
      unsubscribe: () => {
        record.listeners.delete(listener);
      },
    };
  }

  private markTerminal(record: RunRecord): void {
    if (record.terminal) return;
    record.terminal = true;

    const listeners = [...record.listeners];
    record.listeners.clear();
    for (const listener of listeners) {
      try {
        listener({ id: '__terminal__', event: { event: '__terminal__', data: {} } });
      } catch {
        /* noop */
      }
    }

    record.reapTimer = setTimeout(() => {
      this.runs.delete(record.runId);
    }, RUN_TTL_AFTER_TERMINAL_MS);
  }
}
