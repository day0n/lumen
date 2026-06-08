import type { SkillLibrary } from '../../../application/skills.js';
import { type JsonSchema, Tool } from './base.js';

export class LoadSkillTool extends Tool {
  override readonly name = 'use_skill';
  override readonly timeoutSeconds = 10;
  override readonly description =
    'Load an internal skill guide into the conversation. Use canvas-core for workflow basics; use composition-editing for video stitching, trim, split, timeline, BGM, and final MP4 export.';

  override readonly parameters: JsonSchema = {
    type: 'object',
    properties: {
      skill_name: {
        type: 'string',
        description:
          'Skill name: canvas-core (workflow basics) or composition-editing (video timeline editing and final cut).',
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
