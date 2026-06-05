import 'server-only';

import type { HotVideoRecord } from '@lumen/db';
import { z } from 'zod';

import type { Locale } from '@/i18n/routing';
import { getStudioCache } from './db';
import {
  GeminiNotConfiguredError,
  generateGeminiMultimodalText,
  getStudioGoogleClient,
} from './gemini';

/**
 * 爆款复刻 —— 真拆解。
 *
 * 用 Gemini 多模态吃原片视频本体（mp4 字节），让模型同时看到画面和听到音频，
 * 吐结构化 transcript（带时间戳）+ shots（镜头分段）。
 *
 * 拆解结果以 (videoId, locale) 为 key 写 Redis，TTL 24h；同一爆款多次复刻只算一次。
 * Gemini 没配置 / 模型超时 / payload 过大都允许返回 null，调用方走文本兜底路径。
 */

const TranscriptItemSchema = z
  .object({
    startSec: z.number().nonnegative(),
    endSec: z.number().nonnegative(),
    text: z.string().trim().max(400),
  })
  .strict();

const ShotItemSchema = z
  .object({
    startSec: z.number().nonnegative(),
    endSec: z.number().nonnegative(),
    action: z.string().trim().max(280),
    /** Core replicable action stripped of product-specific details. e.g. "creator holds product to camera while speaking" not "creator holds FaceSerum bottle". */
    actionPattern: z.string().trim().max(200).optional(),
    camera: z.string().trim().max(160),
    visual: z.string().trim().max(280),
    dialogue: z.string().trim().max(280).optional(),
  })
  .strict();

export const RemakeBreakdownSchema = z
  .object({
    durationSec: z.number().positive(),
    hook: z.string().trim().max(280),
    angle: z.string().trim().max(280),
    summary: z.string().trim().max(600),
    transcript: z.array(TranscriptItemSchema).max(60).default([]),
    shots: z.array(ShotItemSchema).max(20).default([]),
    /** 原片语言，'zh' / 'en' / 'other'，便于后续 TTS 选声 */
    language: z.string().trim().max(20).default('en'),
    generatedAt: z.string().datetime(),
  })
  .strict();

export type RemakeBreakdown = z.infer<typeof RemakeBreakdownSchema>;

const BREAKDOWN_TTL_SECONDS = 24 * 60 * 60;
const MAX_VIDEO_MB = 18; // Gemini inline_data 实际上限 20MB，留点余量。

export async function analyzeRemakeReference(input: {
  video: HotVideoRecord | null;
  locale: Locale;
  /** 强制忽略缓存重算。 */
  refresh?: boolean;
}): Promise<RemakeBreakdown | null> {
  const { video, locale } = input;
  if (!video) return null;
  const previewUrl = video.previewUrl?.trim();
  if (!previewUrl) return null;

  const cache = getStudioCache();
  const cacheKey = `hot-videos:breakdown:${locale}:${video.id}`;
  if (!input.refresh) {
    const cached = await cache.get(cacheKey, RemakeBreakdownSchema);
    if (cached) return cached;
  }

  let raw: string;
  try {
    raw = await generateGeminiMultimodalText({
      prompt: buildBreakdownPrompt(video, locale),
      mediaUrl: previewUrl,
      mediaMimeType: 'video/mp4',
      maxInlineBytes: MAX_VIDEO_MB * 1024 * 1024,
      temperature: 0.15,
      maxOutputTokens: 8192,
    });
  } catch (error) {
    if (error instanceof GeminiNotConfiguredError) return null;
    console.warn('[remake] breakdown gemini call failed', error);
    return null;
  }

  const parsed = parseBreakdownJson(raw);
  if (!parsed) return null;

  const result = RemakeBreakdownSchema.safeParse({
    ...parsed,
    generatedAt: new Date().toISOString(),
  });
  if (!result.success) {
    console.warn('[remake] breakdown json failed schema', result.error.flatten());
    return null;
  }

  await cache.set(cacheKey, result.data, BREAKDOWN_TTL_SECONDS);
  return result.data;
}

function buildBreakdownPrompt(video: HotVideoRecord, locale: Locale): string {
  const wantZh = locale === 'zh';
  return `
You are analysing a real TikTok Shop viral product video. The full video file is attached to
this request — watch it end to end (visuals AND audio) and extract a STRUCTURED breakdown
that downstream code will use to rebuild the same video for a different product.

Be precise about timestamps and what is actually on screen / spoken. Do NOT invent shots that
aren't there. If the video has no spoken dialogue, return an empty transcript.

Output language for human-readable fields (hook/angle/summary/shot.action/shot.camera/shot.visual):
${wantZh ? 'Chinese (Simplified)' : 'English'}.
Transcript text MUST be in the original spoken language exactly as heard.

Context:
- Title: ${video.title}
- Product: ${video.productName}
- Category: ${video.category}
- Region: ${video.region}

Return ONE JSON object, no markdown, no commentary. Exact shape:
{
  "durationSec": number,
  "language": "zh" | "en" | "other",
  "hook": "one sentence — what makes the first 1.5s grab attention",
  "angle": "one sentence — selling angle / promise to viewer",
  "summary": "two to four sentences — what happens in the video as a whole",
  "transcript": [
    { "startSec": number, "endSec": number, "text": "exact spoken line" }
  ],
  "shots": [
    {
      "startSec": number,
      "endSec": number,
      "action": "what the person/product is doing in this shot (specific)",
      "actionPattern": "the core replicable action stripped of any product-specific detail — describe the MOTION and INTERACTION PATTERN only, e.g. 'creator holds product close to camera lens while speaking directly to viewer' NOT 'creator holds FaceSerum bottle'",
      "camera": "framing / movement — handheld close-up, static medium, etc.",
      "visual": "key visual elements: setting, product placement, on-screen text",
      "dialogue": "optional — what is being said during this shot (matches transcript)"
    }
  ]
}

Constraints:
- Use 3 to 8 shots total, covering the full video without gaps or overlaps.
- Round timestamps to 0.1s precision.
- If you cannot hear the audio at all, set language="other" and transcript=[].
- actionPattern is REQUIRED for every shot — it is the product-agnostic motion skeleton that will be locked when replicating this video for a different product.
`.trim();
}

function parseBreakdownJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch (error) {
    console.warn('[remake] breakdown json parse failed', error);
    return null;
  }
}

export function summarizeBreakdownForPlan(breakdown: RemakeBreakdown | null): string {
  if (!breakdown) return '';
  const lines: string[] = [];
  lines.push(`Original duration: ${breakdown.durationSec.toFixed(1)}s`);
  lines.push(`Hook (first 1.5s): ${breakdown.hook}`);
  lines.push(`Angle: ${breakdown.angle}`);
  lines.push(`Summary: ${breakdown.summary}`);

  if (breakdown.transcript.length > 0) {
    lines.push('Transcript (start-end | line):');
    for (const item of breakdown.transcript) {
      lines.push(`  ${item.startSec.toFixed(1)}-${item.endSec.toFixed(1)} | ${item.text}`);
    }
  } else {
    lines.push('Transcript: (no spoken dialogue detected)');
  }

  if (breakdown.shots.length > 0) {
    lines.push('');
    lines.push('=== REPLICATION SKELETON (LOCKED — DO NOT DEVIATE) ===');
    lines.push('Each scene in the new script MUST match the corresponding locked action pattern.');
    lines.push(
      'Only 4 element classes may be swapped: PRODUCT / DIALOGUE / CREATOR / ENVIRONMENT.',
    );
    lines.push('Scene count must equal the number of rows below.');
    lines.push('');
    lines.push('| Scene | Time | Locked Action Pattern | Camera | Replaceable Elements |');
    lines.push('|-------|------|----------------------|--------|---------------------|');
    for (let i = 0; i < breakdown.shots.length; i++) {
      const shot = breakdown.shots[i]!;
      const label = i === 0 ? `Scene ${i + 1} (HOOK — copy exactly)` : `Scene ${i + 1}`;
      const pattern = shot.actionPattern ?? shot.action;
      lines.push(
        `| ${label} | ${shot.startSec.toFixed(1)}-${shot.endSec.toFixed(1)}s | ${pattern} | ${shot.camera} | product / dialogue / creator / environment |`,
      );
    }
    lines.push('');
    lines.push('=== END REPLICATION SKELETON ===');
  }

  return lines.join('\n');
}

// ============================================================
// 商品图分析：从上传的商品图中提取结构化卖点信息
// ============================================================

export const ProductAnalysisSchema = z
  .object({
    name: z.string().trim().max(120),
    category: z.string().trim().max(80),
    sellingPoints: z.array(z.string().trim().max(200)).min(1).max(5),
    appearance: z.string().trim().max(300),
    useCase: z.string().trim().max(200),
    targetAudience: z.string().trim().max(200),
  })
  .strict();

export type ProductAnalysis = z.infer<typeof ProductAnalysisSchema>;

/**
 * 用 Gemini 多模态分析最多两张商品图，返回结构化卖点。
 * 失败时静默返回 null，调用方降级为仅用商品名。
 */
export async function analyzeProductImages(
  imageUrls: string[],
  locale: 'en' | 'zh',
): Promise<ProductAnalysis | null> {
  if (!imageUrls.length) return null;

  let client: ReturnType<typeof getStudioGoogleClient>;
  try {
    client = getStudioGoogleClient();
  } catch (error) {
    if (error instanceof GeminiNotConfiguredError) return null;
    throw error;
  }

  // 最多取前两张，下载并转 base64
  const imageParts: Array<Record<string, unknown>> = [];
  for (const url of imageUrls.slice(0, 2)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'follow' });
      if (!res.ok) continue;
      const mimeType =
        res.headers.get('content-type')?.split(';')[0]?.trim() ?? guessImageMimeFromUrl(url);
      if (!mimeType.startsWith('image/')) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      imageParts.push({ inlineData: { data: bytes.toString('base64'), mimeType } });
    } catch {
      // 单张图下载失败不影响整体
    }
  }

  if (!imageParts.length) return null;

  const wantZh = locale === 'zh';
  const prompt = `You are analyzing uploaded product images for a short-video UGC ad scriptwriter.
Extract structured product information that will help write specific, compelling voiceover lines.

Output language: ${wantZh ? 'Chinese (Simplified)' : 'English'}.

Return ONE JSON object, no markdown:
{
  "name": "product name as shown or inferred",
  "category": "product category (skincare / electronics / food / apparel / etc.)",
  "sellingPoints": ["3 to 5 specific selling points visible or clearly inferable from the images — be concrete, not generic"],
  "appearance": "brief visual description: color, material, form factor, packaging",
  "useCase": "primary use scenario in one sentence",
  "targetAudience": "inferred target audience in one phrase"
}

Rules:
- sellingPoints must be SPECIFIC (e.g. "含烟酰胺提亮成分" not "效果好")
- If text/labels are visible in the image, extract them
- If unsure about a field, make a reasonable inference from visual cues`;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [...imageParts, { text: prompt }] }],
      config: { temperature: 0.2, maxOutputTokens: 1024 },
    });

    const text = (response.text ?? '').trim();
    if (!text) return null;

    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
    const parsed = JSON.parse(fenced?.[1] ?? text) as unknown;
    const result = ProductAnalysisSchema.safeParse(parsed);
    if (!result.success) {
      console.warn('[remake] product analysis schema mismatch', result.error.flatten());
      return null;
    }
    return result.data;
  } catch (error) {
    console.warn('[remake] product image analysis failed', error);
    return null;
  }
}

export function summarizeProductAnalysis(analysis: ProductAnalysis | null): string {
  if (!analysis) return '';
  const lines: string[] = [];
  lines.push('=== PRODUCT ANALYSIS (from uploaded product images) ===');
  lines.push(`Name: ${analysis.name}`);
  lines.push(`Category: ${analysis.category}`);
  lines.push(`Appearance: ${analysis.appearance}`);
  lines.push(`Use case: ${analysis.useCase}`);
  lines.push(`Target audience: ${analysis.targetAudience}`);
  lines.push('Selling points (use these in voiceLine — be specific, not generic):');
  for (const point of analysis.sellingPoints) {
    lines.push(`  - ${point}`);
  }
  lines.push('=== END PRODUCT ANALYSIS ===');
  return lines.join('\n');
}

// ============================================================
// 场景图分析：从上传的环境图中提取可复用空间锚点
// ============================================================

const EnvironmentItemSchema = z
  .object({
    name: z.string().trim().max(80),
    description: z.string().trim().max(360),
  })
  .strict();

export const EnvironmentAnalysisSchema = z
  .object({
    visualStyle: z.string().trim().max(300),
    environments: z.array(EnvironmentItemSchema).min(1).max(4),
  })
  .strict();

export type EnvironmentAnalysis = z.infer<typeof EnvironmentAnalysisSchema>;

export async function analyzeEnvironmentImages(
  imageUrls: string[],
  locale: 'en' | 'zh',
): Promise<EnvironmentAnalysis | null> {
  if (!imageUrls.length) return null;

  let client: ReturnType<typeof getStudioGoogleClient>;
  try {
    client = getStudioGoogleClient();
  } catch (error) {
    if (error instanceof GeminiNotConfiguredError) return null;
    throw error;
  }

  const imageParts: Array<Record<string, unknown>> = [];
  for (const url of imageUrls.slice(0, 4)) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'follow' });
      if (!res.ok) continue;
      const mimeType =
        res.headers.get('content-type')?.split(';')[0]?.trim() ?? guessImageMimeFromUrl(url);
      if (!mimeType.startsWith('image/')) continue;
      const bytes = Buffer.from(await res.arrayBuffer());
      imageParts.push({ inlineData: { data: bytes.toString('base64'), mimeType } });
    } catch {
      // 单张图下载失败不影响整体
    }
  }

  if (!imageParts.length) return null;

  const wantZh = locale === 'zh';
  const prompt = `You are analyzing uploaded SCENE / ENVIRONMENT reference images for a UGC video remake pipeline.

These images are NOT products and NOT creator portraits. Treat them as reusable spatial anchors.

Output language: ${wantZh ? 'Chinese (Simplified)' : 'English'}.

Return ONE JSON object, no markdown:
{
  "visualStyle": "overall lighting, texture, camera mood, and spatial feel",
  "environments": [
    {
      "name": "short stable environment token name",
      "description": "space layout, surfaces, lighting direction, depth, action zones, and hero camera angle. Do not describe people, hands, products, UI text, or logos."
    }
  ]
}

Rules:
- Create 1 environment if all uploads show the same space; create up to 4 only if they are clearly different spaces.
- The description must be reusable for many scenes: wide view, medium action zone, and close-up demo surface.
- Do not infer product selling points from these images.
- Do not include people or product identity in the environment description.`;

  try {
    const response = await client.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: [{ role: 'user', parts: [...imageParts, { text: prompt }] }],
      config: { temperature: 0.18, maxOutputTokens: 1200 },
    });

    const text = (response.text ?? '').trim();
    if (!text) return null;

    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(text);
    const parsed = JSON.parse(fenced?.[1] ?? text) as unknown;
    const result = EnvironmentAnalysisSchema.safeParse(parsed);
    if (!result.success) {
      console.warn('[remake] environment analysis schema mismatch', result.error.flatten());
      return null;
    }
    return result.data;
  } catch (error) {
    console.warn('[remake] environment image analysis failed', error);
    return null;
  }
}

export function summarizeEnvironmentAnalysis(analysis: EnvironmentAnalysis | null): string {
  if (!analysis) return '';
  const lines: string[] = [];
  lines.push('=== ENVIRONMENT ANALYSIS (from uploaded scene reference images) ===');
  lines.push(`Visual style: ${analysis.visualStyle}`);
  lines.push('Reusable scene environments:');
  for (const environment of analysis.environments) {
    lines.push(`  - ${environment.name}: ${environment.description}`);
  }
  lines.push('Treat these as scene-space anchors, not product or creator references.');
  lines.push('=== END ENVIRONMENT ANALYSIS ===');
  return lines.join('\n');
}

function guessImageMimeFromUrl(url: string): string {
  const path = url.split(/[?#]/)[0] ?? '';
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/png';
}
