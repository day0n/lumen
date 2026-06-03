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
 * LumenCanvas。图的形状跟着骨架走（N 个场次 → N 条 图→视频 分支），但连线规则写死，
 * 不依赖 LLM 现搓画布，保证一键场景下可靠。
 *
 * 节点 id 全部稳定可预测，前端按前缀取预览（脚本 / 锁定图 / 分镜 / 视频 / 成片）。
 */

export interface RemakeScene {
  /** 1-based 场次序号，对应原片逻辑节拍 */
  index: number;
  /** 动作骨架（驱动分镜首帧 prompt） */
  action: string;
  /** 台词 / 旁白（驱动场景视频 prompt 与口播） */
  dialogue: string;
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
}

export interface BuildRemakeCanvasInput {
  /** 复刻脚本全文（写进 text-script 节点） */
  scriptText: string;
  /** 骨架场次（顺序即成片顺序） */
  scenes: RemakeScene[];
  /** 用户上传的商品图（最多取前 2 张作为产品锁定的参考） */
  productImageUrls: string[];
  /** 每场分镜首帧的 i2i prompt（与 scenes 等长、按 index 对应；缺省用 action 兜底） */
  sceneImagePrompts?: string[];
  /** 每场视频 prompt（与 scenes 等长；缺省用 action+camera+dialogue 拼） */
  sceneVideoPrompts?: string[];
  /** 锁定创作者形象的文生图 prompt（缺省走通用 UGC 创作者） */
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
  bgm: 'audio-bgm',
  finalCut: 'video-final-cut',
} as const;

const TEXT_MODEL = getDefaultWorkflowModelId('text'); // gemini-3.5-flash
const IMAGE_MODEL = getDefaultWorkflowModelId('image'); // nano-banana2
const VIDEO_MODEL = 'veo-3.1';
const AUDIO_MODEL = 'suno-music';
const EDIT_MODEL = 'lumen-video-edit';

// 画布布局：左→右分带，y 按场次堆叠。
const COL = { script: 0, lock: 360, sceneImage: 760, sceneVideo: 1160, final: 1600 };
const ROW_H = 320;

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

export function buildRemakeCanvas(input: BuildRemakeCanvasInput): LumenCanvas {
  const { scenes, settings } = input;
  if (scenes.length === 0) {
    throw new Error('buildRemakeCanvas requires at least one scene');
  }

  const aspectRatio = settings.aspectRatio || '9:16';
  // 视频节点必须 720p 才能按骨架 per-scene 时长出片（veo-3.1 约束）。
  const videoResolution = '720p';
  const finalResolution = settings.resolution || '720p';

  const [product0, product1] = input.productImageUrls;

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

  // 2. 创作者形象锁定（文生图，全片同一个人）
  nodes.push(
    node(RemakeNodeIds.creatorLock, 'image', '创作者定妆照（锁定）', COL.lock, 0, {
      prompt:
        input.creatorPrompt ??
        'A clean multi-view character reference sheet of a relatable UGC creator, photorealistic, natural skin and lighting, neutral background. Three rows: standing poses, facial expressions, action poses. Consistent identity across all panels.',
      modelId: IMAGE_MODEL,
      settings: { aspectRatio },
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

  // 4. 逐场：分镜首帧（i2i，参考锁定的创作者+产品）→ 场景视频（i2v，首帧模式）
  for (const [i, scene] of scenes.entries()) {
    const y = i * ROW_H;
    const imgId = RemakeNodeIds.sceneImage(scene.index);
    const vidId = RemakeNodeIds.sceneVideo(scene.index);

    const imagePrompt =
      input.sceneImagePrompts?.[i] ??
      `First-frame keyframe of Scene ${scene.index}. ${scene.action}. Camera: ${scene.camera}. Feature the locked creator holding/wearing the locked product; keep their identity and the product's appearance consistent with the reference images. ${aspectRatio} vertical composition, photorealistic UGC look.`;

    const videoPrompt =
      input.sceneVideoPrompts?.[i] ??
      `Scene ${scene.index}, ~${scene.durationSeconds}s. Action: ${scene.action}. Camera: ${scene.camera}. Spoken line: ${scene.dialogue}. Continue motion from the first-frame keyframe; keep the creator and product identity stable.`;

    nodes.push(
      node(imgId, 'image', `分镜 · 场次${scene.index}`, COL.sceneImage, y, {
        prompt: imagePrompt,
        modelId: IMAGE_MODEL,
        settings: { aspectRatio },
      }),
    );
    nodes.push(
      node(vidId, 'video', `视频 · 场次${scene.index}`, COL.sceneVideo, y, {
        prompt: videoPrompt,
        modelId: VIDEO_MODEL,
        settings: {
          aspectRatio,
          resolution: videoResolution,
          duration: scene.durationSeconds,
        },
      }),
    );

    // 连线：脚本+双锁定图 → 分镜首帧；分镜首帧 → 场景视频；场景视频 → 成片
    edges.push(edge(RemakeNodeIds.script, imgId));
    edges.push(edge(RemakeNodeIds.creatorLock, imgId));
    edges.push(edge(RemakeNodeIds.productLock, imgId));
    edges.push(edge(imgId, vidId));
    edges.push(edge(vidId, RemakeNodeIds.finalCut));
  }

  // 5. 全片 BGM（Suno，给最终剪辑混音；不是 Agent）
  nodes.push(
    node(RemakeNodeIds.bgm, 'audio', '全片 BGM', COL.sceneVideo, scenes.length * ROW_H, {
      prompt:
        input.bgmPrompt ??
        'Instrumental luxury UGC product ad background music, modern, clean, upbeat but not distracting, no vocals, suitable for a vertical TikTok Shop product video.',
      modelId: AUDIO_MODEL,
      settings: { instrumental: true, suno_model: 'V5' },
    }),
  );
  edges.push(edge(RemakeNodeIds.script, RemakeNodeIds.bgm));
  edges.push(edge(RemakeNodeIds.bgm, RemakeNodeIds.finalCut));

  // 6. 成片（lumen-video-edit：按场次顺序拼接，确定性，0 Agent）
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
  bgmNode: string;
  finalNode: string;
}

/** 返回前端逐段运行用的节点边界（与 buildRemakeCanvas 的 id 规则一致）。 */
export function remakeRunBoundaries(scenes: RemakeScene[]): RemakeRunBoundaries {
  return {
    lockNodes: [RemakeNodeIds.creatorLock, RemakeNodeIds.productLock],
    storyboardNodes: scenes.map((s) => RemakeNodeIds.sceneImage(s.index)),
    videoNodes: scenes.map((s) => RemakeNodeIds.sceneVideo(s.index)),
    bgmNode: RemakeNodeIds.bgm,
    finalNode: RemakeNodeIds.finalCut,
  };
}
