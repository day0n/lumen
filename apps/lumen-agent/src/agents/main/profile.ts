/**
 * Main agent profile —— 第一阶段配置：3 个工具 + 一段 system prompt。
 * Skills 暂时全空，等业务工具进来后再补 lumen-script-writing 等 .md。
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { AgentProfile, ToolFactory } from '../../core/profile.js';
import { MediaUnderstandingTool } from '../../core/tools/mediaUnderstanding.js';
import { VideoSearchTool } from '../../core/tools/videoSearch.js';
import { WebSearchTool } from '../../core/tools/web.js';

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

export const MAIN_PROFILE: AgentProfile = {
  name: 'main',
  description: 'Primary conversational agent for the Lumen video studio',
  systemPrompt: SYSTEM_PROMPT,
  toolFactories: [webSearch, videoSearch, mediaUnderstanding],
  inlineSkills: [],
  loadableSkills: [],
  maxIterations: 40,
};
