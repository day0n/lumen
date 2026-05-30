/**
 * Main agent profile —— Studio agent tools + dynamically loadable workflow skills.
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentProfile, ToolFactory } from '../../core/profile.js';
import { MediaUnderstandingTool } from '../../core/tools/mediaUnderstanding.js';
import { VideoSearchTool } from '../../core/tools/videoSearch.js';
import { WebSearchTool } from '../../core/tools/web.js';
import {
  EditWorkflowTool,
  GetWorkflowTool,
  RunWorkflowNodeTool,
} from '../../core/tools/workflow.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SYSTEM_PROMPT = readFileSync(join(__dirname, 'prompt.md'), 'utf-8');

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

const mediaUnderstanding: ToolFactory = (ctx) =>
  new MediaUnderstandingTool({
    googleOcJson: ctx.toolEnv.googleOcJson,
    vertexProject: ctx.toolEnv.vertexProject,
  });

const getWorkflow: ToolFactory = () => new GetWorkflowTool();
const editWorkflow: ToolFactory = () => new EditWorkflowTool();
const runWorkflowNode: ToolFactory = () => new RunWorkflowNodeTool();

export const MAIN_PROFILE: AgentProfile = {
  name: 'main',
  description: 'Primary conversational agent for the Lumen video studio',
  systemPrompt: SYSTEM_PROMPT,
  toolFactories: [
    webSearch,
    videoSearch,
    mediaUnderstanding,
    getWorkflow,
    editWorkflow,
    runWorkflowNode,
  ],
  inlineSkills: [],
  loadableSkills: ['workflow-core'],
  maxIterations: 40,
};
