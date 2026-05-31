/**
 * AgentBuilder —— 把 AgentBlueprint 物化成可运行的 BuiltAgent。
 */

import type { LLMProvider } from '../adapters/outbound/llm/base.js';
import { ToolCatalog } from '../adapters/outbound/tools/registry.js';
import { LoadSkillTool } from '../adapters/outbound/tools/skills.js';
import type {
  AgentBlueprint,
  AgentDeps,
  BlueprintRegistry,
  BuiltAgent,
} from '../domain/profile.js';
import { logger } from '../platform/logger.js';
import type { SkillLibrary } from './skills.js';

export class AgentBuilder {
  constructor(
    public readonly context: AgentDeps,
    public readonly skillsLoader: SkillLibrary,
    public readonly provider: LLMProvider,
    public readonly defaultModel: string,
    public readonly profileRegistry: BlueprintRegistry,
  ) {}

  build(profile: AgentBlueprint): BuiltAgent {
    const tools = new ToolCatalog();
    for (const factory of profile.toolFactories) {
      tools.register(factory(this.context));
    }

    const allowed = [...profile.inlineSkills, ...profile.loadableSkills];
    const filteredSkills =
      allowed.length > 0 ? this.skillsLoader.filtered(allowed) : this.skillsLoader.filtered([]);
    if (allowed.length > 0) {
      tools.register(new LoadSkillTool(filteredSkills));
    }

    let systemPrompt: string;
    if (typeof profile.systemPrompt === 'function') {
      systemPrompt = profile.systemPrompt({
        skillsLoader: filteredSkills,
        toolNames: tools.toolNames,
      });
    } else {
      systemPrompt = profile.systemPrompt;
    }

    const model = profile.model ?? this.defaultModel;

    logger.info(
      {
        profile: profile.name,
        tool_count: tools.size,
        tool_names: tools.toolNames,
        skills: allowed,
        model,
        max_iterations: profile.maxIterations,
      },
      'AgentBuilder build',
    );

    return {
      tools,
      systemPrompt,
      model,
      maxIterations: profile.maxIterations,
    };
  }
}
