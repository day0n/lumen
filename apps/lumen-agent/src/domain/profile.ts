/**
 * AgentBlueprint —— 声明式描述一个 agent 的能力。
 *
 * Profile 是不可变的；AgentBuilder 把它物化成 BuiltAgent（带 ToolCatalog /
 * system prompt / model）。
 */

import type { Tool } from '../adapters/outbound/tools/base.js';
import type { ToolCatalog } from '../adapters/outbound/tools/registry.js';
import type { SkillLibrary } from '../application/skills.js';

/** 工具构造时需要的全局上下文。前期只放最小集，后续按需加。 */
export interface AgentDeps {
  workspaceDir: string;

  /** 出站代理 URL，可选。 */
  webProxy: string | null;

  /** 是否限制工具访问到 workspaceDir。 */
  restrictToWorkspace: boolean;

  /**
   * tool 工厂可以从这里读 provider 配置 / 第三方 client。
   * 前期把所有可选依赖塞这里，避免每个 tool 都改签名。
   */
  toolEnv: {
    braveApiKey?: string;
    foreplayApiKey?: string;
    foreplayBaseUrl?: string;
    googleOcJson?: string;
    vertexProject?: string;
    openaiApiKey?: string;
  };
}

export type ToolFactory = (ctx: AgentDeps) => Tool;

export type SystemPromptBuilder = (input: {
  skillsLoader: SkillLibrary;
  toolNames: string[];
}) => string;

export interface AgentBlueprint {
  readonly name: string;
  readonly description: string;
  readonly systemPrompt: string | SystemPromptBuilder;
  readonly toolFactories: readonly ToolFactory[];
  readonly inlineSkills: readonly string[];
  readonly loadableSkills: readonly string[];
  readonly model?: string;
  readonly maxIterations: number;
}

export interface BuiltAgent {
  readonly tools: ToolCatalog;
  readonly systemPrompt: string;
  readonly model: string;
  readonly maxIterations: number;
}

export class BlueprintRegistry {
  private profiles = new Map<string, AgentBlueprint>();

  register(profile: AgentBlueprint): void {
    this.profiles.set(profile.name, profile);
  }

  get(name: string): AgentBlueprint | undefined {
    return this.profiles.get(name);
  }

  list(): AgentBlueprint[] {
    return [...this.profiles.values()];
  }

  get names(): string[] {
    return [...this.profiles.keys()];
  }

  /** main 之外的所有 profile（subagent 用），前期占位。 */
  subagentProfiles(): AgentBlueprint[] {
    return this.list().filter((p) => p.name !== 'main');
  }
}
