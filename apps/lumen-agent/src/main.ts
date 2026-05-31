/**
 * lumen-agent 启动入口。
 *
 * 顺序：
 *   1. load env / config
 *   2. 连 Mongo + Redis
 *   3. 构造 SkillLibrary / AgentDeps / BlueprintRegistry / ModelRouter
 *   4. ChatRunner / SessionManager
 *   5. Hono server.listen
 */

// ⚠ 必须第一行：Sentry.init 要早于任何 SDK / HTTP 库被 import 才能自动埋点。
import './bootstrap/instrument.js';

import { resolve } from 'node:path';
import { serve } from '@hono/node-server';

import { buildApp } from './adapters/inbound/http/server.js';
import { ModelRouter } from './adapters/outbound/llm/router.js';
import { MemoryManager } from './adapters/outbound/memory.js';
import { closeMongo, getMongo } from './adapters/outbound/persistence/mongo.js';
import { closeRedis, getRedis } from './adapters/outbound/persistence/redis.js';
import { SessionManager } from './adapters/outbound/persistence/session.js';
import { ChatRunner } from './application/chatRunner.js';
import { BUILTIN_SKILLS_DIR, SkillLibrary } from './application/skills.js';
import { getConfig } from './bootstrap/config.js';
import { type AgentDeps, BlueprintRegistry } from './domain/profile.js';
import { logger } from './platform/logger.js';
import { applyOutboundProxy } from './platform/proxy.js';

import { MAIN_PROFILE } from './agents/main/profile.js';

async function main(): Promise<void> {
  // 1. 在任何 SDK 实例化前，根据 env 决定要不要走代理
  await applyOutboundProxy();

  const cfg = getConfig();
  logger.info(
    {
      port: cfg.PORT,
      env: cfg.NODE_ENV,
      default_model: cfg.DEFAULT_MODEL,
      anthropic: !!cfg.ANTHROPIC_API_KEY,
      ark: !!cfg.ARK_API_KEY,
    },
    'lumen-agent 启动',
  );

  const db = await getMongo();
  const redis = getRedis();
  const sessionManager = new SessionManager(db, redis);

  const memory = cfg.OPENAI_API_KEY ? new MemoryManager(db, cfg.OPENAI_API_KEY) : null;

  const skillsLoader = new SkillLibrary(BUILTIN_SKILLS_DIR);
  logger.info(
    { skills_dir: BUILTIN_SKILLS_DIR, skills: skillsLoader.listSkills() },
    'Skills loaded',
  );

  const profileRegistry = new BlueprintRegistry();
  profileRegistry.register(MAIN_PROFILE);

  const context: AgentDeps = {
    workspaceDir: resolve(process.cwd(), 'workspace'),
    webProxy: cfg.HTTP_PROXY || null,
    restrictToWorkspace: false,
    toolEnv: {
      braveApiKey: cfg.BRAVE_API_KEY,
      foreplayApiKey: cfg.FOREPLAY_API_KEY,
      foreplayBaseUrl: cfg.FOREPLAY_BASE_URL,
      googleOcJson: cfg.GOOGLE_OC_JSON,
      vertexProject: cfg.VERTEX_GEMINI_PROJECT,
      openaiApiKey: cfg.OPENAI_API_KEY,
    },
  };

  const providerRouter = new ModelRouter();

  const agentLoop = new ChatRunner({
    context,
    skillsLoader,
    profileRegistry,
    sessionManager,
    providerRouter,
    defaultModel: cfg.DEFAULT_MODEL,
    defaultMaxTokens: cfg.DEFAULT_MAX_TOKENS,
    memory,
  });

  const app = buildApp({
    agentLoop,
    sessionManager,
    corsOrigins: cfg.CORS_ORIGINS.split(',').map((s) => s.trim()),
    clerkIssuer: cfg.CLERK_ISSUER,
  });

  const server = serve({ fetch: app.fetch, port: cfg.PORT }, (info) => {
    logger.info({ port: info.port }, 'HTTP server listening');
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, '收到关闭信号');
    server.close();
    await closeRedis();
    await closeMongo();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error({ err }, 'fatal: lumen-agent 启动失败');
  process.exit(1);
});
