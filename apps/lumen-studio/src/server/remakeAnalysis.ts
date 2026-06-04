import 'server-only';

import type { HotVideoRecord } from '@lumen/db';
import { z } from 'zod';

import type { Locale } from '@/i18n/routing';
import { getStudioCache } from './db';
import { GeminiNotConfiguredError, generateGeminiMultimodalText } from './gemini';

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
      "action": "what the person/product is doing in this shot",
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
  lines.push(`Hook: ${breakdown.hook}`);
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
    lines.push('Shots (start-end | action | camera | visual | dialogue):');
    for (const shot of breakdown.shots) {
      lines.push(
        `  ${shot.startSec.toFixed(1)}-${shot.endSec.toFixed(1)} | ${shot.action} | ${shot.camera} | ${shot.visual} | ${shot.dialogue ?? ''}`,
      );
    }
  }
  return lines.join('\n');
}
