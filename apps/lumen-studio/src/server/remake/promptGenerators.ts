// 勿加 server-only：由 stages.ts 在 server.ts 启动链上加载。
import type {
  RemakeJobCharacter,
  RemakeJobEnvironment,
  RemakeJobPlan,
  RemakeJobScene,
} from '@lumen/db';

import { GeminiNotConfiguredError, getStudioGoogleClient } from '../gemini';

/**
 * Storyboard / Video prompt 生成器。
 *
 * 关键原则（反直觉但正确）：
 * - reference image 已经被作为 image socket 喂进生成模型，模型会"看着图"画。
 * - 所以 prompt 里 **不能** 再描述实体的视觉细节（脸/颜色/品牌/包装），
 *   一描述就会和 reference image 冲突，模型在"听文字"和"看图"之间折中，
 *   结果两边都不对。
 * - 实体只能用 name token 引用：@Name / @keyframe / @product-name。
 * - prompt 只描述：场景构图 / 相机 / 角色动作 / 产品位置和状态 /
 *   空间关系 / 光影氛围。
 *
 * 这两个生成器在每次 stage 跑前由 stages.ts 调用，输出的 prompt 直接喂下游模型。
 */

interface GenerateOptions {
  scene: RemakeJobScene;
  character?: RemakeJobCharacter;
  productName: string;
  aspectRatio: string;
}

interface StoryboardOptions extends GenerateOptions {
  environment?: RemakeJobEnvironment;
  creatorLockUrl: string | null;
  productLockUrl: string | null;
  environmentLockUrl: string | null;
}

interface VideoOptions extends GenerateOptions {
  storyboardUrl: string | null;
}

const MAX_BYTES = 8 * 1024 * 1024;

export async function generateStoryboardPrompt(opts: StoryboardOptions): Promise<string | null> {
  const {
    scene,
    character,
    productName,
    environment,
    creatorLockUrl,
    productLockUrl,
    environmentLockUrl,
    aspectRatio,
  } = opts;

  const imageParts = await Promise.all([
    fetchInlineImage(creatorLockUrl),
    fetchInlineImage(productLockUrl),
    fetchInlineImage(environmentLockUrl),
  ]);
  const validParts = imageParts.filter((p): p is NonNullable<typeof p> => p !== null);
  if (!validParts.length) return null;

  const characterToken = `@${(character?.name?.trim() || 'creator').replace(/\s+/g, '_')}`;
  const productToken = `@${productName.trim().toLowerCase().replace(/\s+/g, '-')}`;
  const environmentToken = `@${(environment?.name?.trim() || 'main-environment')
    .toLowerCase()
    .replace(/\s+/g, '-')}`;

  const meta = `Scene ${scene.index}
- Action: ${scene.action}
- Camera: ${scene.camera}
- On-screen caption: ${scene.dialogue}
- Aspect ratio: ${aspectRatio}
- Character: ${characterToken} (${character?.gender ?? 'unspecified'}, ${character?.ageRange ?? 'adult'}, ${character?.tone ?? 'natural UGC tone'})
- Product: ${productToken}
- Environment: ${environmentToken}${environment?.description ? ` — ${environment.description}` : ''}`;

  const prompt = `You are writing the image-generation prompt for ONE first-frame keyframe of a UGC short ad.

REFERENCE IMAGES ARE ATTACHED:
- Image 1 = locked creator multi-view reference sheet
- Image 2 = locked product multi-view reference sheet
- Image 3 = locked reusable environment / scene-space reference plate

CRITICAL RULES (follow exactly):
1. The downstream image-generation node ALSO receives these same reference images as image inputs. Therefore, do NOT re-describe entity visual details in your prompt. NO character appearance (hair color, skin tone, outfit details, face shape). NO product appearance (packaging color, branding design, label, material, logo). NO environment appearance (wall color, furniture style, decor details). The reference images already define their appearance — re-describing them will conflict with the references and produce incorrect results.
2. Refer to entities by NAME TOKEN ONLY: ${characterToken} for the creator, ${productToken} for the product, ${environmentToken} for the environment. Treat these as opaque identifiers — do not unpack what they look like.
3. Focus ONLY on: scene composition, camera angle / shot type, the creator's POSE and ACTION, the product's POSITION and STATE in frame, spatial relationships inside ${environmentToken}, lighting and atmosphere.
4. The output must be photorealistic UGC, vertical ${aspectRatio} composition, single frame (this is one keyframe, not a sheet).
5. NO subtitles, NO UI text, NO on-screen text overlays, NO logos that are not part of the product itself.

${meta}

Write ONE compact paragraph (3-5 sentences). Return ONLY the prompt text — no preamble, no quotes, no markdown, no headings.`;

  return runGemini(prompt, validParts);
}

export async function generateVideoPrompt(opts: VideoOptions): Promise<string | null> {
  const { scene, character, productName, storyboardUrl, aspectRatio } = opts;
  if (!storyboardUrl) return null;

  const part = await fetchInlineImage(storyboardUrl);
  if (!part) return null;

  const characterName = character?.name?.trim() || 'creator';
  const characterToken = `@${characterName.replace(/\s+/g, '_')}`;
  const productToken = `@${productName.trim().toLowerCase().replace(/\s+/g, '-')}`;
  const characterGender = character?.gender ?? 'unspecified';
  const characterAge = character?.ageRange ?? 'adult';
  const characterTone = character?.tone ?? 'warm friendly UGC creator';

  const voiceLine = (scene.voiceLine ?? scene.dialogue ?? '').trim();

  const prompt = `You are writing the video-generation prompt for ONE scene of a vertical UGC short ad.

@keyframe IS THE STORYBOARD IMAGE ATTACHED (Image 1). The video MUST start exactly from this keyframe and continue motion forward.

CRITICAL RULES:
1. The downstream video model ALSO receives @keyframe as an image input. Do NOT re-describe what is visible in the keyframe (the creator's face, the product's shape/colour/packaging, the environment) — the keyframe already defines all of those. Re-describing will conflict with the visual reference.
2. Refer to entities by NAME TOKEN ONLY: ${characterToken} for the creator, ${productToken} for the product. The literal token "@keyframe" refers to the input image.
3. Describe ONLY: how motion continues from @keyframe, camera movement, ${characterToken}'s action and gesture, ${productToken}'s motion / state change, spatial dynamics. No appearance descriptions.
4. The video model natively generates audio. The character must visibly speak the line below; the model will synthesise the matching voice in one pass.

REQUIRED OUTPUT STRUCTURE (write exactly in this order, multiple short paragraphs):

Paragraph 1 — opening:
"Continue motion forward from @keyframe. Keep ${characterToken}'s identity and ${productToken}'s appearance stable across the clip."

Paragraph 2 — motion description (1-2 sentences): how the action and camera evolve over ~${scene.durationSeconds}s, grounded in what the keyframe already shows.
- Action context: ${scene.action}
- Camera: ${scene.camera}
- Aspect ratio: ${aspectRatio}

Paragraph 3 — voice identity (MANDATORY, copy this line VERBATIM with no edits):
Speaker voice: ${characterToken} — ${characterGender}, ${characterAge}, ${characterTone}.

Paragraph 4 — spoken delivery (MANDATORY, copy VERBATIM, do not paraphrase the line in quotes):
${characterToken} (VO, ${characterGender}) says: "${voiceLine}"

Paragraph 5 — closing:
"Generate the spoken audio natively in ${characterToken}'s voice. The on-screen mouth shapes must match the spoken line above."

Return ONLY the prompt text built from the structure above. No preamble, no quotes around the whole thing, no markdown, no headings, no commentary.`;

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
      model: 'gemini-2.5-flash',
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

export type { RemakeJobPlan };
