/**
 * 爆款复刻 —— 共享类型（v3 任务化架构）。
 *
 * 历史上这里还有 `buildRemakeCanvas` / `RemakeNodeIds` / `remakeRunBoundaries`
 * 把 plan 编译成一张隐藏的 LumenCanvas 来跑。v3 把爆款复刻从 workflow 模型里
 * 拆出来变成独立的 job + atomic task 流水线后，这些 canvas 编译器全部不再需要，
 * 已在 commit `feat(remake): job + atomic task backend` 中删除。
 *
 * 这里只保留两类型 —— `RemakeScene` / `RemakeSettings` —— 因为它们是 plan
 * 生成层（apps/lumen-studio/src/server/remakePlan.ts）和 db 持久层
 * (`@lumen/db` 的 `RemakeJobScene`) 共用的"场次"数据形状的源头。
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
   */
  voiceLine?: string;
  /** 该场时长，秒。受 veo-3.1 约束吸附到 [4, 6, 8]。 */
  durationSeconds: number;
  /** 运镜 / 景别（驱动场景视频 prompt） */
  camera: string;
  /** 1-based 环境索引；同一个环境可被多个场次复用。 */
  environmentIndex?: number;
}

export interface RemakeEnvironment {
  /** 1-based 环境序号，对应 plan.sceneEnvironmentMap 和环境锁定输出。 */
  index: number;
  /** 给 prompt 引用的稳定环境名。 */
  name: string;
  /** 环境/场景空间描述，不包含人物或商品。 */
  description: string;
  /** 复用该环境的场次索引。 */
  usedSceneIndexes: number[];
  /**
   * 用户对该环境锁定 prompt 的显式 override；空 / undefined = 不覆盖，
   * 走 buildEnvironmentLockPrompt 的自动版本。
   */
  prompt?: string;
}

export interface RemakeSettings {
  /** 画面比例，如 '9:16' */
  aspectRatio: string;
  /** 分辨率。默认 '720p'。 */
  resolution?: string;
  /** TTS 声线（fish-tts 的 voice 字段，缺省走自动选） */
  voice?: string;
}
