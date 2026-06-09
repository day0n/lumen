/**
 * 临时自检脚本：验证把 gemini-2.5-flash 全部替换成 gemini-3.5-flash 后，
 * Vertex AI 是否仍然接受这个模型名，以及多模态路径是否仍然工作。
 *
 * 覆盖：
 *   1. 纯文本 generateContent（对应 Studio remakePlan / gemini-flash-lite text handler / agent mediaUnderstanding 文本路径）
 *   2. 多模态 generateContent（inline image + text，对应
 *      analyzeProductImages / analyzeEnvironmentImages / generateStoryboardPrompt /
 *      generateVideoPrompt / generateGeminiMultimodalText）
 *
 * 跑法：
 *   cd apps/lumen-engine && pnpm exec tsx scripts/check-gemini-3.5-flash.ts
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import * as dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { ProxyAgent, setGlobalDispatcher } from 'undici';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// 优先加载 .env.local，再补 .env，避免开发凭证缺失
dotenv.config({ path: path.resolve(__dirname, '..', '.env.local') });
dotenv.config({ path: path.resolve(__dirname, '..', '.env') });

// 本机如果用了代理（zsh 里 export 了 https_proxy/http_proxy/all_proxy），Node fetch 默认
// 不会走代理，会导致连 Google Cloud 直接 ConnectTimeout。这里显式套上 undici ProxyAgent。
const proxyUrl =
  process.env.HTTPS_PROXY ||
  process.env.https_proxy ||
  process.env.HTTP_PROXY ||
  process.env.http_proxy ||
  process.env.ALL_PROXY ||
  process.env.all_proxy;
if (proxyUrl) {
  setGlobalDispatcher(new ProxyAgent(proxyUrl));
  console.log(`[gemini-self-check] using proxy: ${proxyUrl}`);
}

const MODEL = 'gemini-3.5-flash';

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing env: ${name}`);
  }
  return value;
}

function buildClient(): GoogleGenAI {
  const saB64 = requireEnv('GOOGLE_OC_JSON');
  const credentials = JSON.parse(Buffer.from(saB64, 'base64').toString('utf-8'));
  // 关键：所有这次改名涉及的调用代码（studio/server/gemini.ts、studio/server/remakeAnalysis.ts、
  // studio/server/remake/promptGenerators.ts）都默认 location=global；engine 自己也只有在
  // global 才能调到 gemini-3 / gemini-3.5 系列。这里强制 global 模拟真实运行环境。
  return new GoogleGenAI({
    vertexai: true,
    project: requireEnv('GOOGLE_CLOUD_PROJECT'),
    location: 'global',
    googleAuthOptions: { credentials },
  });
}

async function runTextOnly(client: GoogleGenAI): Promise<string> {
  const response = await client.models.generateContent({
    model: MODEL,
    contents: [
      { role: 'user', parts: [{ text: 'Reply with the single word "pong" and nothing else.' }] },
    ],
    config: { temperature: 0, maxOutputTokens: 256 },
  });
  return (response.text ?? '').trim();
}

async function runMultimodal(client: GoogleGenAI): Promise<string> {
  // 1x1 纯红色 PNG，base64 编码
  const redPngBase64 =
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

  const response = await client.models.generateContent({
    model: MODEL,
    contents: [
      {
        role: 'user',
        parts: [
          { inlineData: { data: redPngBase64, mimeType: 'image/png' } },
          {
            text: 'What dominant color is in this image? Reply with the single lowercase color word only.',
          },
        ],
      },
    ],
    config: { temperature: 0, maxOutputTokens: 256 },
  });
  return (response.text ?? '').trim();
}

async function main(): Promise<void> {
  console.log(`[gemini-self-check] model = ${MODEL}`);
  console.log(`[gemini-self-check] project = ${process.env.GOOGLE_CLOUD_PROJECT}`);
  console.log(`[gemini-self-check] location = ${process.env.GOOGLE_CLOUD_LOCATION || 'global'}`);

  const client = buildClient();

  console.log('\n[1/2] text-only generateContent …');
  const textStart = Date.now();
  try {
    const text = await runTextOnly(client);
    console.log(`  ok (${Date.now() - textStart}ms): ${JSON.stringify(text)}`);
  } catch (err) {
    console.error(`  FAIL: ${(err as Error).message}`);
    throw err;
  }

  console.log('\n[2/2] multimodal generateContent (1x1 PNG + text) …');
  const mmStart = Date.now();
  try {
    const text = await runMultimodal(client);
    console.log(`  ok (${Date.now() - mmStart}ms): ${JSON.stringify(text)}`);
  } catch (err) {
    console.error(`  FAIL: ${(err as Error).message}`);
    throw err;
  }

  console.log('\nAll gemini-3.5-flash calls succeeded.');
}

main().catch((err) => {
  console.error('\n[gemini-self-check] aborted:', err);
  process.exit(1);
});
