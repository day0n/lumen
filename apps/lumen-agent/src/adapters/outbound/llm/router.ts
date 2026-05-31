/**
 * Provider 路由 —— 根据 model id 选 provider。
 *
 *   - claude-* → AnthropicProvider
 *   - 其他    → VolcArkProvider（默认）
 */

import { getConfig } from '../config/index.js';
import { logger } from '../observability/logger.js';

import { AnthropicProvider } from './anthropic.js';
import type { LLMProvider } from './base.js';
import { VertexGeminiProvider } from './vertexGemini.js';
import { OpenAIProvider, VolcArkProvider } from './volcArk.js';

export type ProviderName = 'anthropic' | 'volcark' | 'openai' | 'gemini';

export class ModelRouter {
  private readonly cache = new Map<ProviderName, LLMProvider>();

  pick(model: string): { provider: LLMProvider; resolvedModel: string } {
    const name = ModelRouter.classify(model);
    const provider = this.getProvider(name);
    return {
      provider,
      resolvedModel: ModelRouter.stripPrefix(model) || provider.getDefaultModel(),
    };
  }

  pickByName(name: ProviderName): LLMProvider {
    return this.getProvider(name);
  }

  private getProvider(name: ProviderName): LLMProvider {
    const cached = this.cache.get(name);
    if (cached) return cached;

    const cfg = getConfig();
    let provider: LLMProvider;
    if (name === 'anthropic') {
      if (!cfg.ANTHROPIC_API_KEY) {
        throw new Error('ANTHROPIC_API_KEY is not configured');
      }
      provider = new AnthropicProvider({ apiKey: cfg.ANTHROPIC_API_KEY });
    } else if (name === 'volcark') {
      if (!cfg.ARK_API_KEY) {
        throw new Error('ARK_API_KEY is not configured');
      }
      provider = new VolcArkProvider({
        apiKey: cfg.ARK_API_KEY,
        apiBase: cfg.ARK_BASE_URL,
        defaultEndpoint: cfg.ARK_TEXT_ENDPOINT,
      });
    } else if (name === 'gemini') {
      if (!cfg.GOOGLE_OC_JSON) {
        throw new Error('GOOGLE_OC_JSON is not configured');
      }
      provider = new VertexGeminiProvider({
        ocJsonB64: cfg.GOOGLE_OC_JSON,
        project: cfg.VERTEX_GEMINI_PROJECT,
      });
    } else {
      if (!cfg.OPENAI_API_KEY) {
        throw new Error('OPENAI_API_KEY is not configured');
      }
      provider = new OpenAIProvider({ apiKey: cfg.OPENAI_API_KEY });
    }
    this.cache.set(name, provider);
    logger.info({ provider: name }, 'Provider 实例已创建');
    return provider;
  }

  /** 把 "vertex_gemini/gemini-3.5-flash" 之类的前缀剥掉，传给 provider 的 chat()。 */
  static stripPrefix(model: string): string {
    const prefixes = ['vertex_gemini/', 'anthropic/', 'openai/', 'volcark/'];
    for (const p of prefixes) {
      if (model.startsWith(p)) return model.slice(p.length);
    }
    return model;
  }

  static classify(model: string): ProviderName {
    const m = (model ?? '').toLowerCase();
    if (m.startsWith('vertex_gemini/') || m.startsWith('gemini-')) return 'gemini';
    if (m.startsWith('anthropic/') || m.startsWith('claude') || m.includes('anthropic'))
      return 'anthropic';
    if (m.startsWith('openai/') || m.startsWith('gpt')) return 'openai';
    return 'volcark';
  }
}
