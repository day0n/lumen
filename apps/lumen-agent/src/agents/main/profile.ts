/**
 * Main agent profile —— Studio agent tools + dynamically loadable workflow skills.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { InspirationSearchTool } from '../../adapters/outbound/tools/inspirationSearch.js';
import { MediaUnderstandingTool } from '../../adapters/outbound/tools/mediaUnderstanding.js';
import { VideoSearchTool } from '../../adapters/outbound/tools/videoSearch.js';
import { WebSearchTool } from '../../adapters/outbound/tools/web.js';
import {
  EditWorkflowTool,
  GetWorkflowTool,
  RunWorkflowNodeTool,
} from '../../adapters/outbound/tools/workflow.js';
import type { AgentBlueprint, ToolFactory } from '../../domain/profile.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, 'prompt.md');
const BASE_SYSTEM_PROMPT = readFileSync(PROMPT_PATH, 'utf-8');

const webSearch: ToolFactory = (ctx) =>
  new WebSearchTool({
    braveApiKey: ctx.toolEnv.braveApiKey,
    proxy: ctx.webProxy,
  });

const videoSearch: ToolFactory = (ctx) =>
  new VideoSearchTool({
    foreplayApiKey: ctx.toolEnv.foreplayApiKey,
    foreplayBaseUrl: ctx.toolEnv.foreplayBaseUrl,
    openaiApiKey: ctx.toolEnv.openaiApiKey,
  });

const inspirationSearch: ToolFactory = (ctx) =>
  new InspirationSearchTool({
    db: ctx.inspirationDb,
    openaiApiKey: ctx.toolEnv.openaiApiKey,
  });

const mediaUnderstanding: ToolFactory = (ctx) =>
  new MediaUnderstandingTool({
    googleOcJson: ctx.toolEnv.googleOcJson,
    vertexProject: ctx.toolEnv.vertexProject,
  });

const getWorkflow: ToolFactory = () => new GetWorkflowTool();
const editWorkflow: ToolFactory = () => new EditWorkflowTool();
const runWorkflowNode: ToolFactory = () => new RunWorkflowNodeTool();

export const MAIN_PROFILE: AgentBlueprint = {
  name: 'main',
  description: 'Primary conversational agent for the Lumen video studio',
  systemPrompt: ({ skillsLoader }) => {
    const skillsSummary = skillsLoader.buildSkillsSummary();
    if (!skillsSummary) return BASE_SYSTEM_PROMPT;
    return `${BASE_SYSTEM_PROMPT}\n\n## 可按需加载的内部技能\n\n涉及画布或视频剪辑时，先调用 \`use_skill\` 加载对应技能全文，再读写/运行画布。\n\n${skillsSummary}`;
  },
  toolFactories: [
    webSearch,
    videoSearch,
    inspirationSearch,
    mediaUnderstanding,
    getWorkflow,
    editWorkflow,
    runWorkflowNode,
  ],
  inlineSkills: [],
  loadableSkills: ['canvas-core', 'composition-editing'],
  maxIterations: 40,
};
