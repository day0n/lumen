import type { SkillLibrary } from '../skills.js';
import { type JsonSchema, Tool } from './base.js';

export class LoadSkillTool extends Tool {
  override readonly name = 'load_skill';
  override readonly timeoutSeconds = 10;
  override readonly description =
    'Load an internal skill guide into the conversation when a task needs specialized workflow rules.';

  override readonly parameters: JsonSchema = {
    type: 'object',
    properties: {
      skill_name: {
        type: 'string',
        description: 'Name of the skill to load, for example workflow-core.',
      },
    },
    required: ['skill_name'],
  };

  constructor(private readonly skillsLoader: SkillLibrary) {
    super();
  }

  override async execute(args: Record<string, unknown>): Promise<string> {
    const name = String(args.skill_name ?? '').trim();
    if (!name) return 'Error: skill_name is required.';
    const content = this.skillsLoader.loadSkill(name);
    if (!content) {
      const available = this.skillsLoader
        .listSkills()
        .map((skill) => skill.name)
        .join(', ');
      return `Error: skill '${name}' not found. Available skills: ${available || '(none)'}`;
    }
    return content;
  }
}
