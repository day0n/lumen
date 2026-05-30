/**
 * AgentFactory —— 把 AgentProfile 物化成可运行的 AgentInstance。
 */

import { logger } from '../observability/logger.js';
import type { LLMProvider } from '../providers/base.js';
import type { AgentContext, AgentInstance, AgentProfile, ProfileRegistry } from './profile.js';
import type { SkillsLoader } from './skills.js';
import { ToolRegistry } from './tools/registry.js';
import { LoadSkillTool } from './tools/skills.js';

export class AgentFactory {
  constructor(
    public readonly context: AgentContext,
    public readonly skillsLoader: SkillsLoader,
    public readonly provider: LLMProvider,
    public readonly defaultModel: string,
    public readonly profileRegistry: ProfileRegistry,
  ) {}

  build(profile: AgentProfile): AgentInstance {
    const tools = new ToolRegistry();
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
      'AgentFactory build',
    );

    return {
      tools,
      systemPrompt,
      model,
      maxIterations: profile.maxIterations,
    };
  }
}
