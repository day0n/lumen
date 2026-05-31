/**
 * 会话存储 —— Mongo 作持久层，Redis 作缓存层。
 *
 * 读取顺序：先查 Redis 上下文缓存，未命中再从 Mongo 的消息集合重建，仍无则新建。
 * 写入方式：增量插入新消息 + upsert 会话元数据 + 刷新 Redis 缓存。
 *
 * 设计取舍：
 *   - 消息只追加、不改写，以最大化 LLM 端的前缀缓存命中
 *   - 喂给 LLM 的历史会剔除纯展示用的角色（见 LLM_EXCLUDED_ROLES）
 *   - 截取历史窗口时，保证每条 tool 结果都能在窗口内找到对应的 assistant 工具调用
 */

import type Redis from 'ioredis';
import type { Collection, Db } from 'mongodb';

import { logger } from '../observability/logger.js';
import type { ChatMessage, MessageList, StoredMessage } from '../schemas/messages.js';

const REDIS_META_PREFIX = 'lumen:agent:session:meta:';
const REDIS_CTX_PREFIX = 'lumen:agent:session:ctx:';
const REDIS_TTL_SEC = 60 * 60 * 24;

const LLM_EXCLUDED_ROLES = new Set(['act_call', 'act_event', 'act_result', 'flow_event']);

interface SessionDoc {
  _id: string;
  session_id: string;
  user_id: string;
  workflow_id?: string | null;
  channel: string;
  summary: string | null;
  message_count: number;
  turn_count: number;
  status: string;
  revision: number;
  last_seq: number;
  last_message_preview: string | null;
  created_at: Date;
  updated_at: Date;
  metadata: Record<string, unknown>;
}

export interface SessionSummary {
  session_id: string;
  user_id: string;
  workflow_id?: string | null;
  channel: string;
  summary: string | null;
  message_count: number;
  turn_count: number;
  status: string;
  revision: number;
  last_seq: number;
  last_message_preview: string | null;
  created_at: string;
  updated_at: string;
}

export interface SessionListResult {
  sessions: SessionSummary[];
  has_more: boolean;
}

interface MessageDoc {
  session_id: string;
  seq: number;
  role: string;
  turn?: number;
  created_at?: string;
  is_ephemeral?: boolean;
  [extra: string]: unknown;
}

export class Session {
  sessionId: string;
  userId: string;
  workflowId: string | null;
  channel: string;
  messages: StoredMessage[];
  createdAt: Date;
  updatedAt: Date;
  summary: string | null;
  messageCount: number;
  turnCount: number;
  status: string;
  revision: number;
  lastSeq: number;
  lastMessagePreview: string | null;
  metadata: Record<string, unknown>;

  /** 已经持久化到 Mongo 的消息数（append-only 增量写入用） */
  persistedCount: number;

  constructor(opts: {
    sessionId: string;
    userId?: string;
    workflowId?: string | null;
    channel?: string;
    messages?: StoredMessage[];
    persistedCount?: number;
  }) {
    this.sessionId = opts.sessionId;
    this.userId = opts.userId ?? '';
    this.workflowId = opts.workflowId ?? null;
    this.channel = opts.channel ?? 'api';
    this.messages = opts.messages ?? [];
    this.createdAt = new Date();
    this.updatedAt = new Date();
    this.summary = null;
    this.messageCount = 0;
    this.turnCount = 0;
    this.status = 'idle';
    this.revision = 0;
    this.lastSeq = 0;
    this.lastMessagePreview = null;
    this.metadata = {};
    this.persistedCount = opts.persistedCount ?? 0;
  }

  /**
   * 返回喂给 LLM 的消息历史（排除 display 角色，对齐 tool_call 边界）。
   *
   * 如果窗口里出现孤立的 tool 消息（assistant.tool_calls
   * 已被截断），把它前面的所有消息丢掉，避免 provider 报错。
   */
  toLLMHistory(maxMessages = 500): MessageList {
    const all = this.messages.filter(
      (m) => !(m as { is_ephemeral?: boolean }).is_ephemeral && !LLM_EXCLUDED_ROLES.has(m.role),
    );
    let sliced = maxMessages > 0 ? all.slice(-maxMessages) : [...all];

    // 去掉非 user 开头
    const firstUserIdx = sliced.findIndex((m) => m.role === 'user');
    if (firstUserIdx > 0) sliced = sliced.slice(firstUserIdx);

    // 对齐 tool_call 边界
    const start = boundaryAfterOrphanTools(sliced);
    if (start > 0) sliced = sliced.slice(start);

    return sliced as MessageList;
  }

  appendUserMessage(
    content: string | Array<Record<string, unknown>>,
    metadata?: Record<string, unknown>,
  ): void {
    const created = new Date().toISOString();
    this.messages.push({
      role: 'user',
      content,
      ...(metadata ? { metadata } : {}),
      created_at: created,
      turn: this.turnCount,
    } as StoredMessage);
    this.messageCount += 1;
    this.lastMessagePreview = previewOf(content);
  }

  appendAssistantFinal(content: string): void {
    const created = new Date().toISOString();
    this.messages.push({
      role: 'assistant',
      content,
      turn: this.turnCount,
      created_at: created,
    } as StoredMessage);
    this.messageCount += 1;
    this.turnCount += 1;
    this.lastMessagePreview = content.slice(0, 200);
  }

  clear(): void {
    this.messages = [];
    this.persistedCount = 0;
    this.summary = null;
    this.messageCount = 0;
    this.turnCount = 0;
    this.status = 'idle';
    this.revision = 0;
    this.lastSeq = 0;
    this.lastMessagePreview = null;
    this.updatedAt = new Date();
  }
}

function previewOf(content: string | Array<Record<string, unknown>>): string {
  if (typeof content === 'string') return content.slice(0, 200);
  for (const c of content) {
    if (typeof (c as { text?: unknown }).text === 'string') {
      return (c as { text: string }).text.slice(0, 200);
    }
  }
  return '';
}

/**
 * 找到一个安全的起始下标：使得截取出的窗口里，每条 tool 结果都能对应到
 * 窗口内更早的 assistant 工具调用。若某条 tool 结果引用了窗口里不存在的调用，
 * 就把起点推到它之后（它之前的内容连同悬空调用一起丢弃）。
 */
function boundaryAfterOrphanTools(messages: StoredMessage[]): number {
  const knownCallIds = new Set<string>();
  let cut = 0;

  messages.forEach((raw, idx) => {
    const m = raw as ChatMessage;

    if (m.role === 'assistant') {
      for (const tc of m.tool_calls ?? []) {
        if (tc.id) knownCallIds.add(tc.id);
      }
      return;
    }

    if (m.role === 'tool') {
      const callId = m.tool_call_id;
      if (callId && !knownCallIds.has(callId)) {
        // 这条 tool 结果是孤儿：它声称回应的调用不在当前窗口里。
        // 把切点移到它之后，并清空已积累的调用 id（它们都被丢到切点之前了）。
        cut = idx + 1;
        knownCallIds.clear();
      }
    }
  });

  return cut;
}

// ── SessionManager ────────────────────────────────────────────────

export class SessionManager {
  private sessions: Collection<SessionDoc>;
  private messages: Collection<MessageDoc>;

  constructor(
    db: Db,
    private readonly redis: Redis | null,
  ) {
    this.sessions = db.collection<SessionDoc>('chat_sessions');
    this.messages = db.collection<MessageDoc>('chat_messages');
  }

  async getOrCreate(
    sessionId: string,
    userId = '',
    workflowId: string | null = null,
  ): Promise<Session> {
    const existing = await this.getExisting(sessionId);
    if (existing) return existing;

    const fresh = new Session({ sessionId, userId, workflowId });
    logger.info(
      { session_id: sessionId, user_id: userId, workflow_id: workflowId },
      'Session created',
    );
    return fresh;
  }

  async getExisting(sessionId: string): Promise<Session | null> {
    const fromRedis = await this.loadFromRedis(sessionId);
    if (fromRedis) {
      logger.info(
        {
          session_id: sessionId,
          msg_count: fromRedis.messageCount,
          turn_count: fromRedis.turnCount,
        },
        'Session loaded from Redis',
      );
      return fromRedis;
    }

    const fromMongo = await this.loadFromMongo(sessionId);
    if (fromMongo) {
      await this.writeRedis(fromMongo);
      logger.info(
        {
          session_id: sessionId,
          msg_count: fromMongo.messageCount,
          turn_count: fromMongo.turnCount,
        },
        'Session loaded from MongoDB',
      );
      return fromMongo;
    }

    return null;
  }

  async listSessions(opts: {
    userIds: string[];
    workflowId?: string | null;
    limit?: number;
    afterSessionId?: string | null;
  }): Promise<SessionListResult> {
    const userIds = [...new Set(opts.userIds.map((id) => id.trim()).filter(Boolean))];
    if (userIds.length === 0) return { sessions: [], has_more: false };

    const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50);
    const query: Record<string, unknown> = {
      user_id: userIds.length === 1 ? userIds[0] : { $in: userIds },
    };
    if (opts.workflowId) {
      query.workflow_id = opts.workflowId;
    }

    if (opts.afterSessionId) {
      const cursorDoc = await this.sessions.findOne(
        {
          _id: opts.afterSessionId,
          user_id: userIds.length === 1 ? userIds[0] : { $in: userIds },
        },
        { projection: { updated_at: 1 } },
      );
      if (cursorDoc?.updated_at) {
        query.updated_at = { $lt: cursorDoc.updated_at };
      }
    }

    const docs = await this.sessions
      .find(query)
      .sort({ updated_at: -1 })
      .limit(limit + 1)
      .toArray();

    const hasMore = docs.length > limit;
    return {
      sessions: docs.slice(0, limit).map((doc) => ({
        session_id: doc.session_id || doc._id,
        user_id: doc.user_id ?? '',
        workflow_id: doc.workflow_id ?? null,
        channel: doc.channel ?? 'api',
        summary: doc.summary ?? null,
        message_count: doc.message_count ?? 0,
        turn_count: doc.turn_count ?? 0,
        status: doc.status ?? 'idle',
        revision: doc.revision ?? 0,
        last_seq: doc.last_seq ?? 0,
        last_message_preview: doc.last_message_preview ?? null,
        created_at: dateToIso(doc.created_at),
        updated_at: dateToIso(doc.updated_at),
      })),
      has_more: hasMore,
    };
  }

  async save(session: Session): Promise<void> {
    const now = new Date();
    session.updatedAt = now;

    // 用 Mongo 里现有的 max(seq) 来给新增消息分配 seq，防止 redis 落后导致冲突
    let mongoNextSeq = session.persistedCount;
    if (session.messages.length > 0) {
      const maxDoc = await this.messages.findOne(
        { session_id: session.sessionId },
        { sort: { seq: -1 }, projection: { seq: 1 } },
      );
      mongoNextSeq = maxDoc && typeof maxDoc.seq === 'number' ? maxDoc.seq + 1 : 0;
      if (mongoNextSeq < session.persistedCount) {
        logger.warn(
          {
            session_id: session.sessionId,
            redis: session.persistedCount,
            mongo: mongoNextSeq,
            msg_count: session.messages.length,
          },
          'Redis 记录的已落库数超过 Mongo 实际值，回退对齐到 Mongo',
        );
        session.persistedCount = mongoNextSeq;
      }
    }

    const newMessages = session.messages.slice(session.persistedCount);
    const baseSeq = Math.max(session.persistedCount, mongoNextSeq);

    if (newMessages.length > 0) {
      const docs: MessageDoc[] = newMessages.map((msg, i) => ({
        ...(msg as unknown as Record<string, unknown>),
        session_id: session.sessionId,
        seq: baseSeq + i,
      })) as MessageDoc[];
      await this.messages.insertMany(docs, { ordered: true });
      session.persistedCount = session.messages.length;
      session.lastSeq = Math.max(session.lastSeq, docs[docs.length - 1]!.seq);
      session.revision += 1;
    }

    await this.sessions.updateOne(
      { _id: session.sessionId },
      {
        $set: {
          session_id: session.sessionId,
          user_id: session.userId,
          workflow_id: session.workflowId,
          channel: session.channel,
          summary: session.summary,
          message_count: session.messageCount,
          turn_count: session.turnCount,
          status: session.status,
          revision: session.revision,
          last_seq: session.lastSeq,
          last_message_preview: session.lastMessagePreview,
          updated_at: now,
          metadata: session.metadata,
        },
        $setOnInsert: { created_at: session.createdAt },
      },
      { upsert: true },
    );

    await this.writeRedis(session);
    logger.info(
      {
        session_id: session.sessionId,
        new_msgs: newMessages.length,
        turn_count: session.turnCount,
      },
      'Session saved',
    );
  }

  async invalidate(sessionId: string): Promise<void> {
    if (this.redis) {
      await this.redis.del(`${REDIS_CTX_PREFIX}${sessionId}`);
      await this.redis.del(`${REDIS_META_PREFIX}${sessionId}`);
    }
    await this.messages.deleteMany({ session_id: sessionId });
    await this.sessions.updateOne(
      { _id: sessionId },
      {
        $set: {
          updated_at: new Date(),
          summary: null,
          message_count: 0,
          turn_count: 0,
          status: 'idle',
          revision: 0,
          last_seq: 0,
          last_message_preview: null,
          metadata: {},
        },
      },
    );
  }

  // ── Redis helpers ───────────────────────────────────────────────

  private async writeRedis(session: Session): Promise<void> {
    if (!this.redis) return;
    try {
      const ctxDoc = {
        session_id: session.sessionId,
        user_id: session.userId,
        workflow_id: session.workflowId,
        channel: session.channel,
        messages: session.messages,
        summary: session.summary,
        message_count: session.messageCount,
        turn_count: session.turnCount,
        status: session.status,
        revision: session.revision,
        last_seq: session.lastSeq,
        last_message_preview: session.lastMessagePreview,
        created_at: session.createdAt.toISOString(),
        updated_at: session.updatedAt.toISOString(),
        metadata: session.metadata,
        _persisted_count: session.persistedCount,
      };
      await this.redis.setex(
        `${REDIS_CTX_PREFIX}${session.sessionId}`,
        REDIS_TTL_SEC,
        JSON.stringify(ctxDoc),
      );
      const metaDoc = { ...ctxDoc, messages: undefined };
      await this.redis.setex(
        `${REDIS_META_PREFIX}${session.sessionId}`,
        REDIS_TTL_SEC,
        JSON.stringify(metaDoc),
      );
    } catch (err) {
      logger.warn({ err, session_id: session.sessionId }, 'Failed to write session to Redis');
    }
  }

  private async loadFromRedis(sessionId: string): Promise<Session | null> {
    if (!this.redis) return null;
    try {
      const raw = await this.redis.get(`${REDIS_CTX_PREFIX}${sessionId}`);
      if (!raw) return null;
      const doc = JSON.parse(raw) as {
        session_id: string;
        user_id: string;
        workflow_id: string | null;
        channel: string;
        messages: StoredMessage[];
        summary: string | null;
        message_count: number;
        turn_count: number;
        status: string;
        revision: number;
        last_seq: number;
        last_message_preview: string | null;
        created_at: string;
        updated_at: string;
        metadata: Record<string, unknown>;
        _persisted_count: number;
      };
      const session = new Session({
        sessionId: doc.session_id,
        userId: doc.user_id,
        workflowId: doc.workflow_id,
        channel: doc.channel,
        messages: doc.messages ?? [],
        persistedCount: doc._persisted_count ?? doc.messages?.length ?? 0,
      });
      session.summary = doc.summary;
      session.messageCount = doc.message_count;
      session.turnCount = doc.turn_count;
      session.status = doc.status;
      session.revision = doc.revision;
      session.lastSeq = doc.last_seq;
      session.lastMessagePreview = doc.last_message_preview;
      session.createdAt = new Date(doc.created_at);
      session.updatedAt = new Date(doc.updated_at);
      session.metadata = doc.metadata ?? {};
      return session;
    } catch (err) {
      logger.warn({ err, session_id: sessionId }, 'Failed to read session from Redis');
      return null;
    }
  }

  private async loadFromMongo(sessionId: string): Promise<Session | null> {
    const meta = await this.sessions.findOne({ _id: sessionId });
    if (!meta) return null;

    const cursor = this.messages.find({ session_id: sessionId }).sort({ seq: 1 });
    const messages: StoredMessage[] = [];
    for await (const doc of cursor) {
      const {
        _id: _id2,
        session_id: _sid,
        seq: _seq,
        ...rest
      } = doc as unknown as Record<string, unknown> & { _id?: unknown };
      void _id2;
      void _sid;
      void _seq;
      messages.push(rest as unknown as StoredMessage);
    }

    const session = new Session({
      sessionId,
      userId: meta.user_id ?? '',
      workflowId: meta.workflow_id ?? null,
      channel: meta.channel ?? 'api',
      messages,
      persistedCount: messages.length,
    });
    session.summary = meta.summary ?? null;
    session.messageCount = meta.message_count ?? 0;
    session.turnCount = meta.turn_count ?? 0;
    session.status = meta.status ?? 'idle';
    session.revision = meta.revision ?? 0;
    session.lastSeq = meta.last_seq ?? 0;
    session.lastMessagePreview = meta.last_message_preview ?? null;
    session.createdAt = meta.created_at ?? new Date();
    session.updatedAt = meta.updated_at ?? new Date();
    session.metadata = meta.metadata ?? {};
    return session;
  }
}

function dateToIso(value: Date | string | undefined): string {
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') return value;
  return new Date(0).toISOString();
}
