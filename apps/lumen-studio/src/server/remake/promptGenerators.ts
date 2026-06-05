// 勿加 server-only：由 stages.ts 在 server.ts 启动链上加载。
import type { RemakeJobCharacter, RemakeJobPlan, RemakeJobScene } from '@lumen/db';

import { GeminiNotConfiguredError, getStudioGoogleClient } from '../gemini';

/**
 * 主流 UGC 风格的 prompt 生成器：在 stage 跑前用 Gemini 多模态"看着图"
 * 写出具体的分镜 / 视频 prompt。
 *
 * 核心改进 vs. plan-time 一次性写死：
 * - storyboard prompt 喂 productLock + creatorLock 两张图 → 模型能写出
 *   "the white pump bottle from reference"，i2i 生成的分镜对产品保真度更高
 * - video prompt 喂分镜首帧 → 模型能写出和首帧严格对齐的运镜，并按 OC
 *   语法 `Speaker voice: @Name — [gender], [age], [tone].` +
 *   `@Name (VO, [gender]) says: "..."` 给视频模型生成对应口型
 *
 * Gemini 不可用 / 调用失败 → 返回 null，调用方走 fallback 文字 prompt。
 */

interface GenerateOptions {
  scene: RemakeJobScene;
  character?: RemakeJobCharacter;
  aspectRatio: string;
}

interface StoryboardOptions extends GenerateOptions {
  creatorLockUrl: string | null;
  productLockUrl: string | null;
}

interface VideoOptions extends GenerateOptions {
  storyboardUrl: string | null;
}

const MAX_BYTES = 8 * 1024 * 1024;

export async function generateStoryboardPrompt(opts: StoryboardOptions): Promise<string | null> {
  const { scene, character, creatorLockUrl, productLockUrl, aspectRatio } = opts;

  const imageParts = await Promise.all([
    fetchInlineImage(creatorLockUrl),
    fetchInlineImage(productLockUrl),
  ]);
  const validParts = imageParts.filter((p): p is NonNullable<typeof p> => p !== null);
  if (!validParts.length) return null;

  const characterLine = character
    ? `Character: @${character.name} — ${character.gender}, ${character.ageRange}, ${character.tone}. Use the locked creator face from the reference image.`
    : 'Use the locked creator face from the first reference image.';

  const prompt = `You are writing the image generation prompt for a single first-frame keyframe of a UGC short ad.

I am attaching reference images:
${creatorLockUrl ? '- Image 1: locked creator multi-view reference sheet (exact face / body / style to preserve)\n' : ''}${productLockUrl ? `- Image ${creatorLockUrl ? 2 : 1}: locked product multi-view reference sheet (exact shape / colour / branding to preserve)\n` : ''}

Scene info:
- Scene index: ${scene.index}
- Action: ${scene.action}
- Camera: ${scene.camera}
- On-screen caption: ${scene.dialogue}
- Aspect ratio: ${aspectRatio}
${characterLine}

Write a SINGLE image-generation prompt (3-6 sentences, English) that:
1. Describes exactly what the first frame must look like, referencing the actual creator's face and the actual product's shape/colour/branding from the images attached.
2. States the camera framing.
3. Says it must be photorealistic UGC, vertical ${aspectRatio} composition, consistent identity across scenes.
4. Does NOT mention text overlays or captions; just the visual.

Return ONLY the prompt text, no preamble, no quotes, no markdown.`;

  return runGemini(prompt, validParts);
}

export async function generateVideoPrompt(opts: VideoOptions): Promise<string | null> {
  const { scene, character, storyboardUrl, aspectRatio } = opts;
  if (!storyboardUrl) return null;

  const part = await fetchInlineImage(storyboardUrl);
  if (!part) return null;

  const characterName = character?.name?.trim() || 'Speaker';
  const characterGender = character?.gender ?? 'unspecified';
  const characterAge = character?.ageRange ?? 'adult';
  const characterTone = character?.tone ?? 'natural UGC tone';

  const voiceLine = (scene.voiceLine ?? scene.dialogue ?? '').trim();

  const prompt = `You are writing the video-generation prompt for ONE scene of a vertical UGC short ad.

I am attaching the first-frame keyframe (Image 1). The video MUST start exactly from this frame and continue motion forward.

Scene info:
- Scene index: ${scene.index}
- Duration: ~${scene.durationSeconds}s
- Action: ${scene.action}
- Camera: ${scene.camera}
- Aspect ratio: ${aspectRatio}

Character voice card (use this VERBATIM in the output prompt — drives the model's lip-sync):
- Speaker voice: @${characterName} — ${characterGender}, ${characterAge}, ${characterTone}.

Spoken line for this scene: "${voiceLine}"

Write a SINGLE video-generation prompt (4-8 sentences, English) that follows this STRICT template:

1. Open with: "Continue motion from the attached first-frame keyframe. Keep creator identity and product appearance stable."
2. Then describe the action and camera in 1-2 sentences, grounded in what you see in the keyframe.
3. Include this line VERBATIM (do not change punctuation): Speaker voice: @${characterName} — ${characterGender}, ${characterAge}, ${characterTone}.
4. Include this line VERBATIM (do not change punctuation): @${characterName} (VO, ${characterGender}) says: "${voiceLine}"
5. End with: "Audio will be replaced in post; the on-screen mouth shapes must match the spoken line above."

Return ONLY the prompt text, no preamble, no quotes, no markdown.`;

  return runGemini(prompt, [part]);
}

async function runGemini(
  prompt: string,
  imageParts: Array<Record<string, unknown>>,
): Promise<string | null> {
  let client: ReturnType<typeof getStudioGoogleClient>;
  try {
    client = getStudioGoogleClient();
  } catch (err) {
    if (err instanceof GeminiNotConfiguredError) return null;
    throw err;
  }

  try {
    const response = await client.models.generateContent({
      model: 'gemini-3.5-flash',
      contents: [{ role: 'user', parts: [...imageParts, { text: prompt }] }],
      config: { temperature: 0.3, maxOutputTokens: 1024 },
    });
    const text = (response.text ?? '').trim();
    return text || null;
  } catch (err) {
    console.warn('[remake] prompt generator gemini call failed', err);
    return null;
  }
}

async function fetchInlineImage(url: string | null): Promise<Record<string, unknown> | null> {
  if (!url?.trim()) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000), redirect: 'follow' });
    if (!res.ok) return null;
    const ab = await res.arrayBuffer();
    if (ab.byteLength > MAX_BYTES) return null;
    const mimeType =
      res.headers.get('content-type')?.split(';')[0]?.trim() ?? guessMime(url) ?? 'image/png';
    if (!mimeType.startsWith('image/')) return null;
    return {
      inlineData: {
        data: Buffer.from(ab).toString('base64'),
        mimeType,
      },
    };
  } catch {
    return null;
  }
}

function guessMime(url: string): string | null {
  const path = url.split(/[?#]/)[0] ?? '';
  const ext = path.slice(path.lastIndexOf('.') + 1).toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'png') return 'image/png';
  return null;
}

// 暴露 plan 类型给 stages.ts，避免它再 import packages/db 里的子类型
export type { RemakeJobPlan };
