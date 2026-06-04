import 'server-only';

import type { HotVideoRecord } from '@lumen/db';
import type { RemakeScene } from '@lumen/shared/domain';
import { z } from 'zod';

import { GeminiNotConfiguredError, generateGeminiText } from './gemini';
import { type RemakeBreakdown, summarizeBreakdownForPlan } from './remakeAnalysis';

/**
 * 爆款复刻 —— 计划生成层。
 *
 * 输入 = (爆款元信息) + (Gemini 多模态拆解 breakdown) + (可选：用户在 Gate 1 确认过的脚本/卖点/受众)。
 * 输出 = 完整可执行计划：scriptText + scenes(含 voiceLine) + sellingPoints + audienceTags +
 *        creatorPrompt + productPrompt + bgmPrompt + sceneImagePrompts + sceneVideoPrompts。
 *
 * LLM 失败 / 没配 → 走 fallback（优先用 breakdown.shots，其次 analysis.structure，最后写死兜底）。
 */

export const RemakeReferenceSchema = z
  .object({
    id: z.string().trim().min(1),
    label: z.string().trim().min(1).max(180),
    value: z.string().trim().min(1).max(500),
    source: z.enum(['link', 'video']),
  })
  .strict();
export type RemakeReference = z.infer<typeof RemakeReferenceSchema>;

export interface RemakePlan {
  scriptText: string;
  scenes: RemakeScene[];
  sellingPoints: string[];
  audienceTags: string[];
  creatorPrompt?: string;
  productPrompt?: string;
  sceneImagePrompts?: string[];
  sceneVideoPrompts?: string[];
  bgmPrompt?: string;
}

export interface BuildPlanInput {
  video: HotVideoRecord | null;
  reference: RemakeReference;
  prompt?: string;
  productImageCount: number;
  creatorImageCount: number;
  locale: 'en' | 'zh';
  targetDurationSeconds?: number;
  breakdown: RemakeBreakdown | null;
  /** Gate 1 重算时由用户提供的"已确认脚本"，作为强约束传给 LLM。 */
  userScriptText?: string;
  userSellingPoints?: string[];
  userAudienceTags?: string[];
}

export async function tryGenerateRemakePlan(
  input: BuildPlanInput,
): Promise<Partial<RemakePlan> | null> {
  try {
    const text = await generateGeminiText(buildGeminiPrompt(input));
    const parsed = parseJsonObject(text);
    return parsed ? (parsed as Partial<RemakePlan>) : null;
  } catch (error) {
    if (error instanceof GeminiNotConfiguredError) return null;
    console.warn('[hot-videos/remake] Gemini plan generation failed', error);
    return null;
  }
}

export function buildFallbackPlan(input: {
  video: HotVideoRecord | null;
  reference: RemakeReference;
  prompt?: string;
  locale: 'en' | 'zh';
  breakdown: RemakeBreakdown | null;
}): RemakePlan {
  const product = input.video?.productName ?? input.reference.label;
  const hook =
    input.breakdown?.hook ??
    input.video?.analysis.hook ??
    (input.locale === 'zh'
      ? '先展示结果，再解释产品价值'
      : 'Show the result first, then explain the product value');
  const angle =
    input.breakdown?.angle ??
    input.video?.analysis.angle ??
    (input.locale === 'zh'
      ? '真实用户体验 + 快速效果展示'
      : 'Real-user experience plus quick effect reveal');
  // 优先用 breakdown.shots 作为骨架（带真实台词/动作/运镜），其次走 analysis.structure 兜底。
  const skeleton = scenesFromBreakdown(input.breakdown, product, input.locale);
  const scenes = skeleton.length >= 3 ? skeleton : structureToScenes(input, product, hook, angle);

  const scriptText = [
    input.locale === 'zh'
      ? `复刻目标：${input.reference.value}`
      : `Remix target: ${input.reference.value}`,
    input.locale === 'zh' ? `爆点：${hook}` : `Hook: ${hook}`,
    input.locale === 'zh' ? `角度：${angle}` : `Angle: ${angle}`,
    input.prompt
      ? input.locale === 'zh'
        ? `用户补充：${input.prompt}`
        : `User notes: ${input.prompt}`
      : '',
    '',
    ...scenes.map((scene) =>
      input.locale === 'zh'
        ? `${scene.index}. ${scene.action}\n   字幕：${scene.dialogue}\n   口播：${scene.voiceLine ?? scene.dialogue}\n   运镜：${scene.camera}`
        : `${scene.index}. ${scene.action}\n   Caption: ${scene.dialogue}\n   Voice: ${scene.voiceLine ?? scene.dialogue}\n   Camera: ${scene.camera}`,
    ),
  ]
    .filter(Boolean)
    .join('\n');

  return {
    scriptText,
    scenes,
    sellingPoints:
      input.locale === 'zh'
        ? ['结果先行', '真实上手', '痛点对比', '快速转化']
        : ['Result first', 'Real hands-on demo', 'Pain-point contrast', 'Fast conversion'],
    audienceTags:
      input.locale === 'zh'
        ? ['TikTok Shop 买家', '价格敏感用户', '效果导向用户']
        : ['TikTok Shop buyers', 'Value seekers', 'Result-driven shoppers'],
    creatorPrompt:
      'Photorealistic UGC creator identity reference sheet, natural skin, consistent face, neutral background, standing pose, close-up face, hand demonstration pose.',
    productPrompt: `Create a crisp multi-view reference sheet for the uploaded ${product} product image: front, side, three-quarter, detail macro. Preserve exact shape, color, material, and branding.`,
    bgmPrompt:
      'Instrumental modern TikTok Shop product ad music, clean upbeat luxury feel, no vocals, steady rhythm, suitable for UGC product demonstration.',
    sceneImagePrompts: scenes.map(
      (scene) =>
        `Storyboard keyframe for scene ${scene.index}. ${scene.action}. Camera: ${scene.camera}. Keep the locked creator and locked product consistent. Photorealistic vertical UGC frame.`,
    ),
    sceneVideoPrompts: scenes.map(
      (scene) =>
        `Scene ${scene.index}, ${scene.durationSeconds}s. ${scene.action}. Camera: ${scene.camera}. The creator says: "${scene.voiceLine ?? scene.dialogue}". Smooth natural UGC motion, product remains visually consistent. Audio will be replaced in post by clean TTS.`,
    ),
  };
}

export function normalizePlan(
  generated: Partial<RemakePlan> | null,
  fallback: RemakePlan,
): RemakePlan {
  const scenes = normalizeScenes(generated?.scenes, fallback.scenes);
  return {
    scriptText: readString(generated?.scriptText) ?? fallback.scriptText,
    scenes,
    sellingPoints: normalizeStringArray(generated?.sellingPoints, fallback.sellingPoints, 5),
    audienceTags: normalizeStringArray(generated?.audienceTags, fallback.audienceTags, 5),
    creatorPrompt: readString(generated?.creatorPrompt) ?? fallback.creatorPrompt,
    productPrompt: readString(generated?.productPrompt) ?? fallback.productPrompt,
    bgmPrompt: readString(generated?.bgmPrompt) ?? fallback.bgmPrompt,
    sceneImagePrompts: normalizePromptArray(
      generated?.sceneImagePrompts,
      fallback.sceneImagePrompts,
      scenes.length,
    ),
    sceneVideoPrompts: normalizePromptArray(
      generated?.sceneVideoPrompts,
      fallback.sceneVideoPrompts,
      scenes.length,
    ),
  };
}

function buildGeminiPrompt(input: BuildPlanInput): string {
  const video = input.video;
  const product = video?.productName ?? input.reference.label;
  const breakdownText = summarizeBreakdownForPlan(input.breakdown);
  const userScriptBlock = input.userScriptText
    ? `\nGATE-1 USER-CONFIRMED SCRIPT (authoritative — your scriptText output MUST equal this verbatim, and every scene.voiceLine MUST be drawn from this script):\n"""\n${input.userScriptText}\n"""\n`
    : '';
  const userSellingBlock = input.userSellingPoints?.length
    ? `\nGATE-1 USER-CONFIRMED SELLING POINTS (return them as-is in sellingPoints):\n- ${input.userSellingPoints.join('\n- ')}\n`
    : '';
  const userAudienceBlock = input.userAudienceTags?.length
    ? `\nGATE-1 USER-CONFIRMED AUDIENCE TAGS (return them as-is in audienceTags):\n- ${input.userAudienceTags.join('\n- ')}\n`
    : '';
  const breakdownBlock = breakdownText
    ? `\nREPLICATION SKELETON — derived from real multimodal analysis of the original video. This is authoritative.\n${breakdownText}\n`
    : '';

  const replicationRules = breakdownText
    ? `
REPLICATION MODE HARD RULES (violation = invalid output):
1. SCENE COUNT: your scenes array MUST contain exactly the same number of scenes as skeleton rows above. Do not add or remove scenes.
2. HOOK LOCKED: Scene 1 action MUST replicate the Hook pattern exactly — same motion, same camera, same pacing. Only swap product/creator/dialogue.
3. ACTION SKELETON LOCKED: each scene's action MUST be semantically consistent with the corresponding locked action pattern row. The motion and interaction pattern cannot change.
4. ONLY 4 REPLACEABLE CLASSES per scene:
   - PRODUCT → replace with the new product from uploaded images
   - DIALOGUE → rewrite voiceLine and dialogue for the new product; keep same rhythm and duration
   - CREATOR → new creator identity; preserve motion pattern
   - ENVIRONMENT → similar environment type (kitchen stays kitchen, outdoor stays outdoor)
5. CROSS-CHECK: before finalising each scene, verify its action matches the skeleton row. If it doesn't, rewrite it.
6. sceneImagePrompts and sceneVideoPrompts must each contain exactly the same number of entries as scenes.
`
    : '';
  return `
You are building a deterministic "one-click viral product replication" plan for Lumen.

Important workflow:
1. Break down the reference (you already have the real breakdown below — do NOT invent new shots).
2. Produce the script and wait for Gate 1 confirmation.
3. Lock creator identity and product appearance.
4. Produce 3-6 storyboard keyframes and wait for Gate 2 confirmation.
5. Generate per-scene videos + per-scene TTS voiceover + Suno BGM.
6. Final deterministic edit: per-scene mix already has TTS baked in; final cut concats and adds BGM.

Do not invent a canvas. Return only JSON for the hidden workflow builder.
Scene count is determined by the replication skeleton below (when present) — otherwise use 3 to 6 scenes.
Keep every scene suitable for 4s, 6s, or 8s video generation (Veo 3.1 constraint).

Each scene MUST have:
- "dialogue": short on-screen subtitle / line label (will display as caption)
- "voiceLine": the exact words spoken in the scene's voiceover (drives fish-tts; can equal dialogue if simple)
- Both MUST be short enough to fit in durationSeconds at natural speaking pace.

Reference:
- Title: ${video?.title ?? input.reference.value}
- Product: ${product}
- Category: ${video?.category ?? 'unknown'}
- Region: ${video?.region ?? 'unknown'}
- User product/request notes: ${input.prompt ?? ''}
- Uploaded product image count: ${input.productImageCount}
- Uploaded creator reference image count: ${input.creatorImageCount} ${
    input.creatorImageCount > 0
      ? '(creator lock will i2i from these — your creatorPrompt should describe preserving the uploaded face/body)'
      : '(no creator reference — generate a generic UGC creator identity in creatorPrompt)'
  }
- Output language for scriptText / dialogue / voiceLine / sellingPoints / audienceTags: ${input.locale === 'zh' ? 'Chinese' : 'English'}
- Target total video length: ${input.targetDurationSeconds ? `~${input.targetDurationSeconds}s (pick scene count and per-scene duration so the sum lands near this)` : 'flexible'}
${breakdownBlock}${replicationRules}${userScriptBlock}${userSellingBlock}${userAudienceBlock}
Return this exact JSON shape, no markdown:
{
  "scriptText": "full script users can review at Gate 1",
  "sellingPoints": ["3 to 5 product selling points"],
  "audienceTags": ["2 to 5 audience tags"],
  "creatorPrompt": "photorealistic creator identity lock prompt",
  "productPrompt": "product multi-view lock prompt using uploaded product images",
  "bgmPrompt": "instrumental Suno music prompt, no vocals",
  "scenes": [
    {"index": 1, "action": "shot action", "dialogue": "on-screen caption", "voiceLine": "exact spoken voiceover", "durationSeconds": 4, "camera": "framing"}
  ],
  "sceneImagePrompts": ["one image prompt per scene, matching scenes order"],
  "sceneVideoPrompts": ["one video prompt per scene, matching scenes order"]
}
`.trim();
}

function scenesFromBreakdown(
  breakdown: RemakeBreakdown | null,
  product: string,
  locale: 'en' | 'zh',
): RemakeScene[] {
  if (!breakdown || breakdown.shots.length < 3) return [];
  const transcript = breakdown.transcript;
  return breakdown.shots.slice(0, 8).map((shot, index) => {
    const sceneNumber = index + 1;
    const duration = snapDuration(Math.max(2, shot.endSec - shot.startSec));
    const overlap = transcript.find(
      (line) => line.startSec < shot.endSec && line.endSec > shot.startSec,
    );
    const voiceLine =
      (shot.dialogue ?? overlap?.text ?? '').trim() || fallbackVoice(product, locale);
    const dialogue = shot.visual.length <= 80 ? shot.visual : shot.action.slice(0, 80);
    return {
      index: sceneNumber,
      action: shot.action,
      dialogue,
      voiceLine,
      durationSeconds: duration,
      camera: shot.camera,
    };
  });
}

function structureToScenes(
  input: { video: HotVideoRecord | null; locale: 'en' | 'zh' },
  product: string,
  hook: string,
  angle: string,
): RemakeScene[] {
  const structure = normalizeStructure(input.video?.analysis.structure, input.locale);
  const durations = durationPattern(structure.length);
  return structure.map((item, index) => {
    const sceneNumber = index + 1;
    const zh = input.locale === 'zh';
    const dialogue = zh
      ? fallbackChineseLine(sceneNumber, product, hook, angle)
      : fallbackEnglishLine(sceneNumber, product, hook, angle);
    return {
      index: sceneNumber,
      action: zh
        ? `${item}。围绕用户上传商品图中的 ${product} 做真实带货演示`
        : `${item}. Demonstrate ${product} from the uploaded product images in an authentic UGC style`,
      dialogue,
      voiceLine: dialogue,
      durationSeconds: durations[index] ?? 4,
      camera: cameraForIndex(index),
    };
  });
}

function normalizeScenes(value: unknown, fallback: RemakeScene[]): RemakeScene[] {
  if (!Array.isArray(value)) return fallback;
  const rawScenes: RemakeScene[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = value[index];
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const action = readString(record.action);
    const dialogue = readString(record.dialogue);
    const voiceLine = readString(record.voiceLine);
    const camera = readString(record.camera);
    if (!action || !dialogue || !camera) continue;
    const rawDuration =
      typeof record.durationSeconds === 'number' && Number.isFinite(record.durationSeconds)
        ? record.durationSeconds
        : 4;
    rawScenes.push({
      index: index + 1,
      action,
      dialogue,
      voiceLine: voiceLine ?? dialogue,
      durationSeconds: snapDuration(rawDuration),
      camera,
    });
    if (rawScenes.length >= 8) break;
  }
  return rawScenes.length >= 3 ? rawScenes : fallback;
}

function normalizeStructure(value: string[] | undefined, locale: 'en' | 'zh'): string[] {
  const cleaned = (value ?? [])
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 6);
  if (cleaned.length >= 3) return cleaned;
  return locale === 'zh'
    ? ['结果先行开场', '痛点和产品对比', '上手演示细节', '价格/场景强化', '转化收口']
    : [
        'Result-first opening',
        'Pain point and product contrast',
        'Hands-on detail demo',
        'Value or use-case reinforcement',
        'Conversion close',
      ];
}

function durationPattern(count: number): number[] {
  if (count <= 3) return [4, 6, 6].slice(0, count);
  if (count === 4) return [4, 4, 4, 6];
  return Array.from({ length: count }, () => 4);
}

function snapDuration(raw: number): number {
  const supported = [4, 6, 8];
  return supported.find((value) => value >= raw) ?? 8;
}

function cameraForIndex(index: number): string {
  const cameras = [
    'tight handheld close-up, result visible immediately',
    'medium shot, creator demonstrates the product naturally',
    'macro detail shot, hands show texture and key feature',
    'quick pan-up reveal, product stays centered',
    'stable front-facing testimonial shot',
    'final close-up with product and call-to-action',
  ];
  return cameras[index] ?? cameras[cameras.length - 1]!;
}

function fallbackVoice(product: string, locale: 'en' | 'zh'): string {
  return locale === 'zh'
    ? `这就是 ${product} 的真实使用效果`
    : `This is what ${product} actually does for you`;
}

function fallbackChineseLine(scene: number, product: string, hook: string, angle: string): string {
  const lines = [
    `你先看这个效果，${product} 的重点就是 ${hook}`,
    '我最在意的是它能不能真的解决这个痛点，答案是可以',
    '这里看细节，质感和使用方式都很清楚',
    `${angle}，所以日常使用会更稳定`,
    '想要同款效果的话，直接看这个产品就行',
    '最后再看一遍结果，重点是真的省事',
  ];
  return lines[scene - 1] ?? lines[0]!;
}

function fallbackEnglishLine(scene: number, product: string, hook: string, angle: string): string {
  const lines = [
    `Look at the result first. The point of ${product} is ${hook}.`,
    'I wanted to know if it actually solves the problem, and it does.',
    'Here is the detail: the texture and the way it works are clear.',
    `${angle}, so it feels easier to use every day.`,
    'If you want the same effect, this is the product to check.',
    'One last look at the result. It is simple and practical.',
  ];
  return lines[scene - 1] ?? lines[0]!;
}

function normalizeStringArray(value: unknown, fallback: string[], max: number): string[] {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, max);
  return cleaned.length ? cleaned : fallback;
}

function normalizePromptArray(
  value: unknown,
  fallback: string[] | undefined,
  expectedLength: number,
): string[] | undefined {
  if (!Array.isArray(value)) return fallback;
  const cleaned = value
    .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    .map((item) => item.trim())
    .slice(0, expectedLength);
  if (cleaned.length !== expectedLength) return fallback;
  return cleaned;
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function parseJsonObject(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return JSON.parse(fenced?.[1] ?? trimmed) as Record<string, unknown>;
}
