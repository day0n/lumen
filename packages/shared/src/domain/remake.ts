import {
  type LumenCanvas,
  type LumenCanvasEdge,
  type LumenCanvasNode,
  getDefaultWorkflowModelId,
} from './workflow.js';

/**
 * 爆款复刻 —— 确定性建图器。
 *
 * 吃「参考视频拆出的骨架 + 商品图 + 复刻脚本」，吐一张拓扑正确、可直接逐节点运行的
 * LumenCanvas。图的形状跟着骨架走（N 个场次 → N 条 图→视频→混音 分支），但连线规则写死，
 * 不依赖 LLM 现搓画布，保证一键场景下可靠。
 *
 * 节点 id 全部稳定可预测，前端按前缀取预览（脚本 / 锁定图 / 分镜 / 视频 / 口播 / 混音 / 成片）。
 *
 * 关键拓扑变化（v2，2026-06）：
 * - 每场加 `audio-voice-{i}`（fish-tts，喂 voiceLine）
 * - 每场加 `video-scene-mix-{i}`（lumen-video-edit 单片混音，把 TTS 盖到场景视频上）
 * - 成片只拼 mix 输出 + 全片 BGM，避免在成片层做精细对位
 * - 创作者锁定支持用户上传参考图（i2i），不再只是文生图盲盒
 */

export interface RemakeScene {
  /** 1-based 场次序号，对应原片逻辑节拍 */
  index: number;
  /** 动作骨架（驱动分镜首帧 prompt） */
  action: string;
  /**
   * 字幕 / 关键文案（用于展示和成片字幕）。
   * 历史字段，新版本中口播请用 voiceLine。
   */
  dialogue: string;
  /**
   * 口播文本（驱动 TTS 节点；缺省 = dialogue）。
   * 跟原片台词节奏对齐时优先用这个字段，dialogue 留作字幕。
   */
  voiceLine?: string;
  /** 该场时长，秒（驱动视频节点生成长度，成片按此对齐原片节奏） */
  durationSeconds: number;
  /** 运镜 / 景别（驱动场景视频 prompt） */
  camera: string;
}

export interface RemakeSettings {
  /** 画面比例，如 '9:16' */
  aspectRatio: string;
  /**
   * 分辨率。默认 '720p'。
   * 注意：veo-3.1 在 1080p/4k 会强制锁 8 秒，只有 720p 尊重 per-scene duration，
   * 因此复刻要按骨架时长出片必须用 720p。
   */
  resolution?: string;
  /** TTS 声线（fish-tts 的 voice 字段，缺省走 Rachel） */
  voice?: string;
}

export interface BuildRemakeCanvasInput {
  /** 复刻脚本全文（写进 text-script 节点） */
  scriptText: string;
  /** 骨架场次（顺序即成片顺序） */
  scenes: RemakeScene[];
  /** 用户上传的商品图（最多取前 2 张作为产品锁定的参考） */
  productImageUrls: string[];
  /**
   * 用户上传的创作者参考图（最多取前 2 张，喂 image-creator-lock 做 i2i）。
   * 缺省时走文生图（兜底身份）。
   */
  creatorImageUrls?: string[];
  /** 每场分镜首帧的 i2i prompt（与 scenes 等长、按 index 对应；缺省用 action 兜底） */
  sceneImagePrompts?: string[];
  /** 每场视频 prompt（与 scenes 等长；缺省用 action+camera+dialogue 拼） */
  sceneVideoPrompts?: string[];
  /** 锁定创作者形象的 prompt（缺省走通用 UGC 创作者） */
  creatorPrompt?: string;
  /** 锁定产品多视图的 i2i prompt（缺省走通用产品参考图） */
  productPrompt?: string;
  /** 全片 BGM 生成 prompt（缺省走轻奢带货氛围音乐） */
  bgmPrompt?: string;
  settings: RemakeSettings;
}

/** 稳定节点 id —— 前后端共用，前端据此取每步预览。 */
export const RemakeNodeIds = {
  script: 'text-script',
  creatorLock: 'image-creator-lock',
  productLock: 'image-product-lock',
  sceneImage: (index: number) => `image-scene-${index}`,
  sceneVideo: (index: number) => `video-scene-${index}`,
  sceneVoice: (index: number) => `audio-voice-${index}`,
  sceneMix: (index: number) => `video-scene-mix-${index}`,
  bgm: 'audio-bgm',
  finalCut: 'video-final-cut',
} as const;

const TEXT_MODEL = getDefaultWorkflowModelId('text'); // gemini-3.5-flash
const IMAGE_MODEL = getDefaultWorkflowModelId('image'); // nano-banana2
const VIDEO_MODEL = 'veo-3.1';
const TTS_MODEL = 'fish-tts';
const MUSIC_MODEL = 'suno-music';
const EDIT_MODEL = 'lumen-video-edit';
const DEFAULT_VOICE_EN = 'Rachel';
const DEFAULT_VOICE_ZH = 'AD_Sister';

// 画布布局：左→右分带，y 按场次堆叠。
const COL = {
  script: 0,
  lock: 360,
  sceneImage: 760,
  sceneVideo: 1160,
  sceneVoice: 1160,
  sceneMix: 1560,
  final: 1960,
};
const ROW_H = 320;
const VOICE_ROW_OFFSET = 160;

function node(
  id: string,
  kind: LumenCanvasNode['data']['kind'],
  title: string,
  x: number,
  y: number,
  opts: { prompt?: string; modelId: string; settings?: Record<string, unknown> },
): LumenCanvasNode {
  return {
    id,
    type: 'lumenNode',
    position: { x, y },
    data: {
      kind,
      title,
      prompt: opts.prompt ?? '',
      output: null,
      modelId: opts.modelId,
      settings: opts.settings ?? {},
      status: 'idle',
      error: null,
      progress: 0,
    },
  };
}

function edge(source: string, target: string): LumenCanvasEdge {
  return { id: `e-${source}__${target}`, source, target, type: 'lumenSmooth', data: {} };
}

function pickDefaultVoice(scriptText: string, voice?: string): string {
  if (voice?.trim()) return voice.trim();
  // 简单启发式：脚本含 CJK 字符走中文女声，否则走英文女声。
  return /[\u4e00-\u9fff]/.test(scriptText) ? DEFAULT_VOICE_ZH : DEFAULT_VOICE_EN;
}

export function buildRemakeCanvas(input: BuildRemakeCanvasInput): LumenCanvas {
  const { scenes, settings } = input;
  if (scenes.length === 0) {
    throw new Error('buildRemakeCanvas requires at least one scene');
  }

  const aspectRatio = settings.aspectRatio || '9:16';
  // 视频节点必须 720p 才能按骨架 per-scene 时长出片（veo-3.1 约束）。
  const videoResolution = '720p';
  const finalResolution = settings.resolution || '720p';
  const ttsVoice = pickDefaultVoice(input.scriptText, settings.voice);

  const [product0, product1] = input.productImageUrls;
  const [creator0, creator1] = input.creatorImageUrls ?? [];
  const hasCreatorRef = Boolean(creator0);

  const nodes: LumenCanvasNode[] = [];
  const edges: LumenCanvasEdge[] = [];

  // 1. 复刻脚本（叙事唯一真源）
  nodes.push(
    node(RemakeNodeIds.script, 'text', '复刻脚本', COL.script, 0, {
      prompt: input.scriptText,
      modelId: TEXT_MODEL,
    }),
  );
  nodes[0]!.data.output = input.scriptText;
  nodes[0]!.data.status = 'success';
  nodes[0]!.data.progress = 1;

  // 2. 创作者形象锁定。
  //    有用户参考图 → i2i（喂 inputImage / inputLastFrameImage），完全保留用户人物；
  //    没参考图 → 文生图（通用 UGC 创作者，兜底）。
  const creatorLockPrompt = hasCreatorRef
    ? (input.creatorPrompt ??
      'A clean multi-view character reference sheet of the uploaded creator: standing pose, close-up face, hand demonstration pose. Preserve the exact face, hair, body shape, skin tone, and overall style from the reference image. Photorealistic, natural lighting, neutral background. Consistent identity across all panels.')
    : (input.creatorPrompt ??
      'A clean multi-view character reference sheet of a relatable UGC creator, photorealistic, natural skin and lighting, neutral background. Three rows: standing poses, facial expressions, action poses. Consistent identity across all panels.');
  nodes.push(
    node(RemakeNodeIds.creatorLock, 'image', '创作者定妆照（锁定）', COL.lock, 0, {
      prompt: creatorLockPrompt,
      modelId: IMAGE_MODEL,
      settings: {
        aspectRatio,
        ...(creator0 ? { inputImage: creator0 } : {}),
        ...(creator1 ? { inputLastFrameImage: creator1 } : {}),
      },
    }),
  );

  // 3. 产品多视图锁定（i2i，喂用户上传商品图，全片同一件产品）
  nodes.push(
    node(RemakeNodeIds.productLock, 'image', '产品多视图（锁定）', COL.lock, ROW_H, {
      prompt:
        input.productPrompt ??
        'A clean multi-view product reference sheet of the uploaded product on a plain white background: front, side, and three-quarter angles. Preserve the exact product shape, color, material and branding from the reference image. Studio lighting, crisp focus.',
      modelId: IMAGE_MODEL,
      settings: {
        aspectRatio,
        ...(product0 ? { inputImage: product0 } : {}),
        ...(product1 ? { inputLastFrameImage: product1 } : {}),
      },
    }),
  );

  // 4. 逐场：分镜首帧 → 场景视频 + 场景口播 → 场景混音（视频 + TTS）
  for (const [i, scene] of scenes.entries()) {
    const yScene = i * ROW_H;
    const imgId = RemakeNodeIds.sceneImage(scene.index);
    const vidId = RemakeNodeIds.sceneVideo(scene.index);
    const voiceId = RemakeNodeIds.sceneVoice(scene.index);
    const mixId = RemakeNodeIds.sceneMix(scene.index);

    const imagePrompt =
      input.sceneImagePrompts?.[i] ??
      `First-frame keyframe of Scene ${scene.index}. ${scene.action}. Camera: ${scene.camera}. Feature the locked creator holding/wearing the locked product; keep their identity and the product's appearance consistent with the reference images. ${aspectRatio} vertical composition, photorealistic UGC look.`;

    const videoPrompt =
      input.sceneVideoPrompts?.[i] ??
      `Scene ${scene.index}, ~${scene.durationSeconds}s. Action: ${scene.action}. Camera: ${scene.camera}. Continue motion from the first-frame keyframe; keep the creator and product identity stable. The locked creator visibly mouths the line as natural lip-sync (audio will be replaced in post): "${scene.voiceLine ?? scene.dialogue}".`;

    const voiceLine = (scene.voiceLine ?? scene.dialogue ?? '').trim();

    nodes.push(
      node(imgId, 'image', `分镜 · 场次${scene.index}`, COL.sceneImage, yScene, {
        prompt: imagePrompt,
        modelId: IMAGE_MODEL,
        settings: { aspectRatio },
      }),
    );
    nodes.push(
      node(vidId, 'video', `视频 · 场次${scene.index}`, COL.sceneVideo, yScene, {
        prompt: videoPrompt,
        modelId: VIDEO_MODEL,
        settings: {
          aspectRatio,
          resolution: videoResolution,
          duration: scene.durationSeconds,
        },
      }),
    );
    nodes.push(
      node(
        voiceId,
        'audio',
        `口播 · 场次${scene.index}`,
        COL.sceneVoice,
        yScene + VOICE_ROW_OFFSET,
        {
          prompt: voiceLine,
          modelId: TTS_MODEL,
          settings: { voice: ttsVoice },
        },
      ),
    );
    nodes.push(
      node(mixId, 'video', `混音 · 场次${scene.index}`, COL.sceneMix, yScene, {
        modelId: EDIT_MODEL,
        settings: {
          aspectRatio,
          resolution: videoResolution,
          // veo 自带的环境音几乎全是幻觉，先静音让 TTS 主导；后续要保留再调高。
          defaultClipVolume: 0,
          // TTS 走 BGM 通道，开到 1.0 确保口播清晰。
          bgmVolume: 1,
          trimHeadSeconds: 0,
          flashTransition: false,
          renderSubtitles: false,
        },
      }),
    );

    // 连线：脚本+双锁定图 → 分镜首帧；分镜首帧 → 场景视频；
    //       视频+TTS → 场景混音；脚本 → 口播（语义上下文）；
    //       场景混音 → 成片。
    edges.push(edge(RemakeNodeIds.script, imgId));
    edges.push(edge(RemakeNodeIds.creatorLock, imgId));
    edges.push(edge(RemakeNodeIds.productLock, imgId));
    edges.push(edge(imgId, vidId));
    edges.push(edge(RemakeNodeIds.script, voiceId));
    edges.push(edge(vidId, mixId));
    edges.push(edge(voiceId, mixId));
    edges.push(edge(mixId, RemakeNodeIds.finalCut));
  }

  // 5. 全片 BGM（Suno，给最终剪辑混音）
  nodes.push(
    node(RemakeNodeIds.bgm, 'audio', '全片 BGM', COL.sceneMix, scenes.length * ROW_H, {
      prompt:
        input.bgmPrompt ??
        'Instrumental luxury UGC product ad background music, modern, clean, upbeat but not distracting, no vocals, suitable for a vertical TikTok Shop product video.',
      modelId: MUSIC_MODEL,
      settings: { instrumental: true, suno_model: 'V5' },
    }),
  );
  edges.push(edge(RemakeNodeIds.script, RemakeNodeIds.bgm));
  edges.push(edge(RemakeNodeIds.bgm, RemakeNodeIds.finalCut));

  // 6. 成片（lumen-video-edit：按场次顺序拼接 mix 输出 + BGM，统一字幕快闪，0 Agent）
  const finalY = ((scenes.length - 1) * ROW_H) / 2;
  nodes.push(
    node(RemakeNodeIds.finalCut, 'video', '最终成片', COL.final, finalY, {
      modelId: EDIT_MODEL,
      settings: {
        aspectRatio,
        resolution: finalResolution,
        trimHeadSeconds: 0.2,
        flashTransition: true,
        renderSubtitles: true,
        bgmVolume: 0.28,
        clipTitles: scenes.map((scene) => scene.dialogue).filter(Boolean),
      },
    }),
  );

  return { nodes, edges };
}

export interface RemakeRunBoundaries {
  lockNodes: string[];
  storyboardNodes: string[];
  videoNodes: string[];
  voiceNodes: string[];
  sceneMixNodes: string[];
  bgmNode: string;
  finalNode: string;
}

/** 返回前端逐段运行用的节点边界（与 buildRemakeCanvas 的 id 规则一致）。 */
export function remakeRunBoundaries(scenes: RemakeScene[]): RemakeRunBoundaries {
  return {
    lockNodes: [RemakeNodeIds.creatorLock, RemakeNodeIds.productLock],
    storyboardNodes: scenes.map((s) => RemakeNodeIds.sceneImage(s.index)),
    videoNodes: scenes.map((s) => RemakeNodeIds.sceneVideo(s.index)),
    voiceNodes: scenes.map((s) => RemakeNodeIds.sceneVoice(s.index)),
    sceneMixNodes: scenes.map((s) => RemakeNodeIds.sceneMix(s.index)),
    bgmNode: RemakeNodeIds.bgm,
    finalNode: RemakeNodeIds.finalCut,
  };
}
