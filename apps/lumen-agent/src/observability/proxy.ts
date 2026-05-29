/**
 * 出站代理（仅根据环境变量 HTTPS_PROXY / HTTP_PROXY 决定）。
 *
 * - 生产 / 服务器：不设这两个变量 → 本文件 no-op，所有 fetch 直连。
 * - 本地开发：在 shell 里 `export HTTPS_PROXY=http://127.0.0.1:7890` 即可让
 *   所有 LLM provider / 工具走代理。Node 内置 fetch 默认不读 HTTPS_PROXY，
 *   所以这里用 undici 的 ProxyAgent 显式注入 globalDispatcher。
 *
 * 必须在任何 SDK 实例化（@anthropic-ai/sdk / openai）之前调用。
 */

import { logger } from './logger.js';

export async function applyOutboundProxy(): Promise<void> {
  const proxy =
    process.env.HTTPS_PROXY ??
    process.env.https_proxy ??
    process.env.HTTP_PROXY ??
    process.env.http_proxy;
  if (!proxy) return;

  const { ProxyAgent, setGlobalDispatcher } = await import('undici');
  setGlobalDispatcher(new ProxyAgent(proxy));
  logger.info({ proxy }, '已启用 outbound HTTP 代理（fetch / undici globalDispatcher）');
}
