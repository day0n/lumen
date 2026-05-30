/**
 * AgentLoop —— 顶层处理引擎。
 *
 *   1. 加载 session（消息历史）
 *   2. AgentFactory.build → 拿到 ToolRegistry / system prompt / model
 *   3. PromptBuilder 拼接 messages
 *   4. AgentExecutor.run（流式，hooks 转 SSE 事件）
 *   5. 把新消息追加到 session，持久化
 *   6. emit run.completed
 *
 * 与 executor 的区别：loop 负责"对外的事件流 + session 落地"，executor
 * 只负责"LLM/tool 迭代本身"。两层分开方便后续给 subagent 复用 executor。
 */

import { nanoid } from 'nanoid';

import * as Sentry from '@sentry/node';
import type { Span } from '@sentry/node';

import { logger, withLogContext } from '../observability/logger.js';
import type { LLMProvider } from '../providers/base.js';
import type { ProviderRouter } from '../providers/router.js';
import type { MessageList } from '../schemas/messages.js';
import type { Session, SessionManager } from '../session/manager.js';

import {
  type AgentEvent,
  agentCompleted,
  agentFailed,
  agentStarted,
  messageDelta,
  runCompleted,
  runFailed,
  stepCompleted,
  stepStarted,
  thinkingDelta,
  toolCompleted,
  toolEvent,
  toolStarted,
} from './events.js';
import { AgentExecutor, type ExecutorHooks } from './executor.js';
import { AgentFactory } from './factory.js';
import { type MemoryManager, formatMemoriesForPrompt } from './memory.js';
import type { AgentContext, AgentInstance, AgentProfile, ProfileRegistry } from './profile.js';
import { buildMessages } from './prompt/builder.js';
import type { SkillsLoader } from './skills.js';

export interface RunInput {
  sessionId: string;
  userId: string;
  message: string | Array<Record<string, unknown>>;
  metadata?: Record<string, unknown>;
  /** 浏览器→agent HTTP 请求的 trace 上下文，用于在 fire-and-forget 后台任务里续接同一条 trace。 */
  traceData?: { sentryTrace: string; baggage?: string };
}

export interface AgentLoopOptions {
  context: AgentContext;
  skillsLoader: SkillsLoader;
  profileRegistry: ProfileRegistry;
  sessionManager: SessionManager;
  providerRouter: ProviderRouter;
  defaultModel: string;
  defaultMaxTokens?: number;
  memory?: MemoryManager | null;
}

type EventEmitter = (event: AgentEvent) => void | Promise<void>;

export class AgentLoop {
  private readonly opts: AgentLoopOptions;

  constructor(opts: AgentLoopOptions) {
    this.opts = opts;
  }

  /**
   * 运行一轮对话，把所有事件通过 emit 推出去。
   * emit 会被 SSE writer 包成 `data: ...\n\n`。
   */
  async run(
    input: RunInput,
    profileName: 'main' | string,
    emit: EventEmitter,
    runIdHint?: string,
  ): Promise<void> {
    const profile = this.opts.profileRegistry.get(profileName);
    if (!profile) {
      const ev = agentFailed(`Unknown agent profile: ${profileName}`, {
        code: 'profile_not_found',
      });
      await emit(ev);
      return;
    }

    const runId = runIdHint ?? nanoid(12);

    const runBody = () =>
      withLogContext({ session_id: input.sessionId, run_id: runId, user_id: input.userId }, () =>
        Sentry.startSpan(
          {
            name: 'agent.run',
            op: 'agent.run',
            forceTransaction: true,
            attributes: {
              run_id: runId,
              session_id: input.sessionId,
              'user.id': input.userId,
              profile: profileName,
            },
          },
          async () => {
            try {
              await emit(agentStarted(input.sessionId, runId));

              const session = await this.opts.sessionManager.getOrCreate(
                input.sessionId,
                input.userId,
              );
              const instance = this.buildInstance(profile);

              // 检索长期记忆并注入 system prompt
              let systemPrompt = instance.systemPrompt;
              const userQuery =
                typeof input.message === 'string' ? input.message : JSON.stringify(input.message);
              if (this.opts.memory && input.userId && input.userId !== 'anonymous') {
                const memories = await this.opts.memory.retrieve(input.userId, userQuery);
                const memoryBlock = formatMemoriesForPrompt(memories);
                if (memoryBlock) {
                  systemPrompt = systemPrompt + memoryBlock;
                }
              }

              const provider = this.resolveProvider(instance.model);
              const messages: MessageList = buildMessages({
                systemPrompt,
                history: session.toLLMHistory(),
                userMessage: input.message,
              });

              // 把当前 user 消息也写入 session 的内部存储（display 用）
              session.appendUserMessage(input.message, input.metadata);

              const executor = new AgentExecutor({
                provider,
                model: instance.model,
                tools: instance.tools,
                maxIterations: instance.maxIterations,
                maxTokens: this.opts.defaultMaxTokens,
                hooks: this.makeHooks(emit),
              });

              const result = await executor.run(messages);

              // 持久化最终的 assistant 消息（最后一条 assistant or final content）
              session.appendAssistantFinal(result.content);
              await this.opts.sessionManager.save(session);

              // 异步存储长期记忆（不阻塞响应）
              if (this.opts.memory && input.userId && input.userId !== 'anonymous') {
                void this.opts.memory.store(input.userId, [
                  { role: 'user', content: userQuery },
                  { role: 'assistant', content: result.content },
                ]);
              }

              if (result.finish_reason === 'error') {
                await emit(
                  agentFailed(result.content, {
                    code: 'agent_error',
                    details: result.terminal_error ?? undefined,
                  }),
                );
                await emit(runFailed(runId, result.content));
                return;
              }

              await emit(agentCompleted(result.content, result.usage));
              await emit(runCompleted(runId));
              logger.info(
                {
                  tools_used: result.tools_used,
                  iterations: result.iterations,
                  usage: result.usage,
                },
                'Agent run 完成',
              );
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              logger.error({ err }, 'Agent run 异常');
              await emit(agentFailed(message, { code: 'internal_error' }));
              await emit(runFailed(runId, message));
            }
          },
        ),
      );

    // fire-and-forget 的 run 在 HTTP 请求返回之后才真正执行，必须在这里
    // 手动续接浏览器发起的 trace，否则后台 span 会脱离原始 trace。
    if (input.traceData?.sentryTrace) {
      await Sentry.continueTrace(
        { sentryTrace: input.traceData.sentryTrace, baggage: input.traceData.baggage ?? null },
        runBody,
      );
    } else {
      await runBody();
    }
  }

  private resolveProvider(model: string): LLMProvider {
    return this.opts.providerRouter.pick(model).provider;
  }

  private buildInstance(profile: AgentProfile): AgentInstance {
    const factory = new AgentFactory(
      this.opts.context,
      this.opts.skillsLoader,
      this.resolveProvider(profile.model ?? this.opts.defaultModel),
      this.opts.defaultModel,
      this.opts.profileRegistry,
    );
    return factory.build(profile);
  }

  private makeHooks(emit: EventEmitter): ExecutorHooks {
    // 工具 start/end 是两个回调，用 tool_call_id 把 inactive span 串起来。
    // 在 onToolStart 时活跃 span 是 agent.run，startInactiveSpan 会自动挂为其子 span。
    const toolSpans = new Map<string, Span>();
    return {
      onStepStart: (i) => {
        return Promise.resolve(emit(stepStarted(i)));
      },
      onStepEnd: (i) => {
        return Promise.resolve(emit(stepCompleted(i)));
      },
      onTextDelta: (text) => {
        return Promise.resolve(emit(messageDelta(text)));
      },
      onThinkingDelta: (text) => {
        return Promise.resolve(emit(thinkingDelta(text)));
      },
      onToolStart: (name, id, args) => {
        toolSpans.set(
          id,
          Sentry.startInactiveSpan({
            name: `tool.${name}`,
            op: 'tool.execute',
            attributes: { tool_name: name, tool_call_id: id },
          }),
        );
        return Promise.resolve(
          emit(toolStarted({ tool_name: name, tool_call_id: id, arguments: args })),
        );
      },
      onToolEnd: (name, id, bytes, error, _args, status, durationMs) => {
        const span = toolSpans.get(id);
        if (span) {
          span.setAttributes({ output_size_bytes: bytes, status });
          span.setStatus({ code: error ? 2 : 1 });
          span.end();
          toolSpans.delete(id);
        }
        return Promise.resolve(
          emit(
            toolCompleted({
              tool_name: name,
              tool_call_id: id,
              output_size_bytes: bytes,
              duration_ms: durationMs,
              truncated: false,
              error,
              status,
            }),
          ),
        );
      },
      onToolEvent: (name, ev) => {
        return Promise.resolve(emit(toolEvent({ tool_name: name, event: ev.name, data: ev.data })));
      },
    };
  }
}
