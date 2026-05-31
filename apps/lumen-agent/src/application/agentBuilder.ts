/**
 * AgentBuilder —— 把 AgentBlueprint 物化成可运行的 BuiltAgent。
 */

import { logger } from '../observability/logger.js';
import type { LLMProvider } from '../providers/base.js';
import type { AgentBlueprint, AgentDeps, BlueprintRegistry, BuiltAgent } from './profile.js';
import type { SkillLibrary } from './skills.js';
import { ToolCatalog } from './tools/registry.js';
import { LoadSkillTool } from './tools/skills.js';

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
