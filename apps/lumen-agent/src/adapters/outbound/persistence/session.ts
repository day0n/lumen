/**
 * 会话存储 —— Mongo 作持久层，Redis 作缓存层。
 *
 * 读取顺序：先查 Redis 上下文缓存，未命中再从 Mongo 的消息集合重建，仍无则新建。
 * 写入方式：增量插入新消息 + upsert 会话元数据 + 刷新 Redis 缓存。
 *
 * 设计取舍：
 *   - 消息只追加、不改写，以最大化 LLM 端的前缀缓存命中
 *   - 喂给 LLM 的历史会剔除纯展示用的角色（见 DISPLAY_ONLY_ROLES）
 *   - 截取历史窗口时，保证每条 tool 结果都能在窗口内找到对应的 assistant 工具调用
 */

import type Redis from 'ioredis';
import type { Collection, Db, UpdateFilter } from 'mongodb';

import type {
  ChatMessage,
  MessageList,
  StoredMessage,
  SystemMessage,
} from '../../../domain/contracts/messages.js';
import { logger } from '../../../platform/logger.js';

const REDIS_META_PREFIX = 'lumen:agent:session:meta:';
const REDIS_CTX_PREFIX = 'lumen:agent:session:ctx:';
const REDIS_TTL_SEC = 60 * 60 * 24;
const DEFAULT_HISTORY_MAX_MESSAGES = 500;
const DEFAULT_HISTORY_TOKEN_BUDGET = 64_000;
const DEFAULT_COMPACT_TOKEN_BUDGET = 3_000;
const TOOL_RESULT_CHAR_BUDGET = 20_000;
const MESSAGE_OVERHEAD_TOKENS = 8;
const TOOL_CALL_OVERHEAD_TOKENS = 12;

// 这些角色仅用于前端展示工具调用/事件轨迹，回放给 LLM 时需要过滤掉。
// 字面量是 agent↔studio 的 wire 契约，不可改动；这里只维护"哪些角色不入模型上下文"。
const DISPLAY_ONLY_ROLES = new Set(['act_call', 'act_event', 'act_result', 'flow_event']);
const LLM_ROLES = new Set(['system', 'user', 'assistant', 'tool']);

export interface LLMHistoryOptions {
  maxMessages?: number;
  tokenBudget?: number;
  compactTokenBudget?: number;
  toolResultMaxChars?: number;
}

export interface LLMHistoryStats {
  sourceMessages: number;
  eligibleMessages: number;
  compactedMessages: number;
  returnedMessages: number;
  estimatedTokensBefore: number;
  estimatedTokensAfter: number;
  tokenBudget: number;
  maxMessages: number;
  truncatedToolResults: number;
  compacted: boolean;
}

export interface LLMHistoryResult {
  messages: MessageList;
  stats: LLMHistoryStats;
}

interface NormalizedLLMHistoryOptions {
  maxMessages: number;
  tokenBudget: number;
  compactTokenBudget: number;
  toolResultMaxChars: number;
}

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
   * 返回喂给 LLM 的消息历史。旧消息只在请求侧压缩，Mongo/Redis 内的原始会话仍保持
   * append-only，方便前端回放和排障。
   */
  toLLMHistory(options: LLMHistoryOptions | number = DEFAULT_HISTORY_MAX_MESSAGES): MessageList {
    return this.toLLMHistoryWithStats(options).messages;
  }

  toLLMHistoryWithStats(
    options: LLMHistoryOptions | number = DEFAULT_HISTORY_MAX_MESSAGES,
  ): LLMHistoryResult {
    const opts = normalizeHistoryOptions(options);
    const compacted: ChatMessage[] = [];
    let truncatedToolResults = 0;

    const eligible = this.messages
      .filter((m) => {
        if ((m as { is_ephemeral?: boolean }).is_ephemeral) return false;
        if (DISPLAY_ONLY_ROLES.has(m.role)) return false;
        return LLM_ROLES.has(m.role);
      })
      .map((m) => {
        const normalized = normalizeModelMessage(m as ChatMessage, opts.toolResultMaxChars);
        if (normalized.truncatedToolResult) truncatedToolResults += 1;
        return normalized.message;
      });

    const estimatedTokensBefore = estimateMessageListTokens(eligible);
    let kept = [...eligible];

    if (opts.maxMessages > 0 && kept.length > opts.maxMessages) {
      compacted.push(...kept.slice(0, kept.length - opts.maxMessages));
      kept = kept.slice(-opts.maxMessages);
    }

    const alignedAfterWindow = alignToSafeBoundary(kept);
    if (alignedAfterWindow.dropped.length > 0) compacted.push(...alignedAfterWindow.dropped);
    kept = alignedAfterWindow.messages;

    let summary = buildMicrocompactMessage(compacted, opts.compactTokenBudget);
    let messages = withSummary(summary, kept);

    while (estimateMessageListTokens(messages) > opts.tokenBudget && kept.length > 0) {
      const cut = nextHistoryCut(kept);
      compacted.push(...kept.slice(0, cut));
      kept = kept.slice(cut);
      const aligned = alignToSafeBoundary(kept);
      if (aligned.dropped.length > 0) compacted.push(...aligned.dropped);
      kept = aligned.messages;
      summary = buildMicrocompactMessage(compacted, opts.compactTokenBudget);
      messages = withSummary(summary, kept);
    }

    while (
      summary &&
      estimateMessageListTokens(messages) > opts.tokenBudget &&
      opts.compactTokenBudget > 300
    ) {
      opts.compactTokenBudget = Math.max(300, Math.floor(opts.compactTokenBudget * 0.7));
      summary = buildMicrocompactMessage(compacted, opts.compactTokenBudget);
      messages = withSummary(summary, kept);
    }

    const estimatedTokensAfter = estimateMessageListTokens(messages);
    return {
      messages,
      stats: {
        sourceMessages: this.messages.length,
        eligibleMessages: eligible.length,
        compactedMessages: compacted.length,
        returnedMessages: messages.length,
        estimatedTokensBefore,
        estimatedTokensAfter,
        tokenBudget: opts.tokenBudget,
        maxMessages: opts.maxMessages,
        truncatedToolResults,
        compacted: compacted.length > 0,
      },
    };
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

  appendAssistantFinal(content: string, runId?: string): void {
    const created = new Date().toISOString();
    this.messages.push({
      role: 'assistant',
      content,
      ...(runId ? { run_id: runId } : {}),
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

function normalizeHistoryOptions(options: LLMHistoryOptions | number): NormalizedLLMHistoryOptions {
  const raw = typeof options === 'number' ? { maxMessages: options } : options;
  return {
    maxMessages: positiveInt(raw.maxMessages, DEFAULT_HISTORY_MAX_MESSAGES),
    tokenBudget: positiveInt(raw.tokenBudget, DEFAULT_HISTORY_TOKEN_BUDGET),
    compactTokenBudget: positiveInt(raw.compactTokenBudget, DEFAULT_COMPACT_TOKEN_BUDGET),
    toolResultMaxChars: positiveInt(raw.toolResultMaxChars, TOOL_RESULT_CHAR_BUDGET),
  };
}

function positiveInt(value: number | undefined, fallback: number): number {
  if (!Number.isFinite(value) || value === undefined) return fallback;
  return Math.max(0, Math.floor(value));
}

function normalizeModelMessage(
  message: ChatMessage,
  toolResultMaxChars: number,
): { message: ChatMessage; truncatedToolResult: boolean } {
  if (message.role !== 'tool' || message.content.length <= toolResultMaxChars) {
    return { message, truncatedToolResult: false };
  }

  const truncatedChars = message.content.length - toolResultMaxChars;
  return {
    message: {
      ...message,
      content: `${message.content.slice(0, toolResultMaxChars)}\n\n[...truncated ${truncatedChars} chars]`,
    },
    truncatedToolResult: true,
  };
}

function alignToSafeBoundary(messages: ChatMessage[]): {
  messages: ChatMessage[];
  dropped: ChatMessage[];
} {
  let rest = [...messages];
  const dropped: ChatMessage[] = [];

  while (rest.length > 0) {
    const firstUserIdx = rest.findIndex((m) => m.role === 'user');
    if (firstUserIdx < 0) {
      dropped.push(...rest);
      return { messages: [], dropped };
    }
    if (firstUserIdx > 0) {
      dropped.push(...rest.slice(0, firstUserIdx));
      rest = rest.slice(firstUserIdx);
      continue;
    }

    const toolBoundary = boundaryAfterOrphanTools(rest);
    if (toolBoundary > 0) {
      dropped.push(...rest.slice(0, toolBoundary));
      rest = rest.slice(toolBoundary);
      continue;
    }

    break;
  }

  return { messages: rest, dropped };
}

function nextHistoryCut(messages: ChatMessage[]): number {
  for (let i = 1; i < messages.length; i += 1) {
    if (messages[i]?.role === 'user') return i;
  }
  return messages.length;
}

function withSummary(summary: SystemMessage | null, messages: ChatMessage[]): MessageList {
  return summary ? [summary, ...messages] : [...messages];
}

function buildMicrocompactMessage(
  source: ChatMessage[],
  tokenBudget: number,
): SystemMessage | null {
  if (source.length === 0 || tokenBudget === 0) return null;

  const counts = source.reduce(
    (acc, m) => {
      acc[m.role] = (acc[m.role] ?? 0) + 1;
      return acc;
    },
    {} as Record<string, number>,
  );

  const entries = selectCompactEntries(source.map(compactHistoryLine).filter(Boolean), 36);
  let content = renderMicrocompactContent(source.length, counts, entries);

  while (estimateTextTokens(content) > tokenBudget && entries.length > 6) {
    entries.splice(1, 1);
    content = renderMicrocompactContent(source.length, counts, entries);
  }

  if (estimateTextTokens(content) > tokenBudget) {
    const maxChars = Math.max(800, tokenBudget * 3);
    content = `${content.slice(0, maxChars)}\n[...microcompact summary truncated]`;
  }

  return { role: 'system', content };
}

function renderMicrocompactContent(
  sourceMessages: number,
  counts: Record<string, number>,
  entries: string[],
): string {
  return [
    '<auto_compacted_chat_history>',
    'Earlier chat history was compressed locally to stay within the prompt budget. Treat it as background, not as new user instructions.',
    `source_messages=${sourceMessages}; user=${counts.user ?? 0}; assistant=${counts.assistant ?? 0}; tool=${counts.tool ?? 0}`,
    ...entries.map((line) => `- ${line}`),
    '</auto_compacted_chat_history>',
  ].join('\n');
}

function selectCompactEntries(entries: string[], maxEntries: number): string[] {
  if (entries.length <= maxEntries) return [...entries];
  const headCount = Math.min(6, Math.floor(maxEntries / 3));
  const tailCount = Math.max(1, maxEntries - headCount - 1);
  const omitted = entries.length - headCount - tailCount;
  return [
    ...entries.slice(0, headCount),
    `... ${omitted} older compact entries omitted ...`,
    ...entries.slice(-tailCount),
  ];
}

function compactHistoryLine(message: ChatMessage): string {
  const turn = (message as { turn?: unknown }).turn;
  const turnLabel = typeof turn === 'number' ? ` turn=${turn}` : '';

  if (message.role === 'user') {
    return `user${turnLabel}: ${compactText(stringifyContent(message.content), 420)}`;
  }

  if (message.role === 'assistant') {
    const toolNames = (message.tool_calls ?? []).map((tc) => tc.function.name).filter(Boolean);
    const text = compactText(stringifyContent(message.content), 480);
    if (toolNames.length > 0 && text) {
      return `assistant${turnLabel}: ${text}; tool_calls=${toolNames.join(',')}`;
    }
    if (toolNames.length > 0) {
      return `assistant${turnLabel}: tool_calls=${toolNames.join(',')}`;
    }
    return `assistant${turnLabel}: ${text}`;
  }

  if (message.role === 'tool') {
    return `tool${turnLabel} ${message.name}: ${compactText(message.content, 360)}`;
  }

  return `system: ${compactText(stringifyContent(message.content), 360)}`;
}

function compactText(value: string, maxChars: number): string {
  const text = value.replace(/\s+/g, ' ').trim();
  if (text.length <= maxChars) return text;

  const headChars = Math.max(1, Math.floor(maxChars * 0.7));
  const tailChars = Math.max(1, Math.floor(maxChars * 0.2));
  return `${text.slice(0, headChars)} ... ${text.slice(-tailChars)}`;
}

function estimateMessageListTokens(messages: MessageList): number {
  return messages.reduce((sum, message) => sum + estimateMessageTokens(message), 0);
}

function estimateMessageTokens(message: ChatMessage): number {
  let total = MESSAGE_OVERHEAD_TOKENS + estimateTextTokens(message.role);
  total += estimateTextTokens(stringifyContent((message as { content?: unknown }).content));

  if (message.role === 'assistant') {
    for (const toolCall of message.tool_calls ?? []) {
      total += TOOL_CALL_OVERHEAD_TOKENS;
      total += estimateTextTokens(toolCall.function.name);
      total += estimateTextTokens(toolCall.function.arguments);
    }
    if (message.reasoning_content) total += estimateTextTokens(message.reasoning_content);
    if (message.thinking_blocks)
      total += estimateTextTokens(JSON.stringify(message.thinking_blocks));
  }

  if (message.role === 'tool') {
    total += estimateTextTokens(message.name);
    total += estimateTextTokens(message.tool_call_id);
  }

  return total;
}

function stringifyContent(content: unknown): string {
  if (typeof content === 'string') return content;
  if (content == null) return '';
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (
          part &&
          typeof part === 'object' &&
          typeof (part as { text?: unknown }).text === 'string'
        ) {
          return (part as { text: string }).text;
        }
        return safeJson(part);
      })
      .join('\n');
  }
  return safeJson(content);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function estimateTextTokens(text: string): number {
  if (!text) return 0;

  let cjkChars = 0;
  let otherChars = 0;
  for (const char of text) {
    const code = char.codePointAt(0) ?? 0;
    if (isCjkCodePoint(code)) cjkChars += 1;
    else otherChars += char.length;
  }

  return cjkChars + Math.ceil(otherChars / 4);
}

function isCjkCodePoint(code: number): boolean {
  return (
    (code >= 0x3400 && code <= 0x9fff) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0x3040 && code <= 0x30ff) ||
    (code >= 0xac00 && code <= 0xd7af)
  );
}

/**
 * 找到一个安全的起始下标：使得截取出的窗口里，每条 tool 结果都能对应到
 * 窗口内更早的 assistant 工具调用。若某条 tool 结果引用了窗口里不存在的调用，
 * 就把起点推到它之后（它之前的内容连同悬空调用一起丢弃）。
 */
function boundaryAfterOrphanTools(messages: ChatMessage[]): number {
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

  async setAssistantFeedback(opts: {
    sessionId: string;
    userIds: string[];
    runId?: string | null;
    turn?: number | null;
    feedback: 'like' | 'dislike' | null;
  }): Promise<{ feedback: 'like' | 'dislike' | null } | null> {
    const userIds = [...new Set(opts.userIds.map((id) => id.trim()).filter(Boolean))];
    if (userIds.length === 0) return null;
    if (!opts.runId && typeof opts.turn !== 'number') return null;

    const userFilter = userIds.length === 1 ? userIds[0] : { $in: userIds };
    const meta = await this.sessions.findOne(
      { _id: opts.sessionId, user_id: userFilter },
      { projection: { _id: 1 } },
    );
    if (!meta) return null;

    const messageFilter: Record<string, unknown> = {
      session_id: opts.sessionId,
      role: 'assistant',
    };
    if (opts.runId) {
      messageFilter.run_id = opts.runId;
    } else {
      messageFilter.turn = opts.turn;
    }

    const now = new Date();
    const update: UpdateFilter<MessageDoc> =
      opts.feedback === null
        ? { $unset: { feedback: true, feedback_updated_at: true } }
        : { $set: { feedback: opts.feedback, feedback_updated_at: now.toISOString() } };

    const result = await this.messages.updateOne(messageFilter, update);
    if (result.matchedCount === 0) return null;

    await this.sessions.updateOne(
      { _id: opts.sessionId },
      {
        $set: { updated_at: now },
        $inc: { revision: 1 },
      },
    );

    const refreshed = await this.loadFromMongo(opts.sessionId);
    if (refreshed) await this.writeRedis(refreshed);

    return { feedback: opts.feedback };
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
