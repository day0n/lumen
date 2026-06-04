import 'server-only';

import type { HotVideoRecord } from '@lumen/db';

import type { Locale } from '@/i18n/routing';
import { getHotVideo } from '@/server/hotVideos';
import { type RemakeBreakdown, analyzeRemakeReference } from '@/server/remakeAnalysis';
import {
  type RemakePlan,
  type RemakeReference,
  buildFallbackPlan,
  normalizePlan,
  tryGenerateRemakePlan,
} from '@/server/remakePlan';

/**
 * 爆款复刻 job 创建 / replan 时使用的 plan 生成入口。
 *
 * 复用现有 remakeAnalysis + remakePlan 这两层，输入输出对齐 job 模型。
 */

export interface BuildPlanForJobInput {
  reference: RemakeReference;
  /** 源爆款视频（如果是从爆款库点进来的）；用于多模态拆解。 */
  video: HotVideoRecord | null;
  productImageCount: number;
  creatorImageCount: number;
  locale: Locale;
  userPrompt?: string;
  targetDurationSeconds?: number;
  /** Gate 1 replan 时由用户提供的"已确认"内容，作为强约束传给 LLM。 */
  gateOverrides?: {
    scriptText?: string;
    sellingPoints?: string[];
    audienceTags?: string[];
  };
}

export interface BuildPlanForJobOutput {
  plan: RemakePlan;
  breakdown: RemakeBreakdown | null;
}

export async function buildPlanForJob(input: BuildPlanForJobInput): Promise<BuildPlanForJobOutput> {
  const locale: 'en' | 'zh' = input.locale === 'zh' ? 'zh' : 'en';

  const breakdown = await analyzeRemakeReference({ video: input.video, locale });

  const fallback = buildFallbackPlan({
    video: input.video,
    reference: input.reference,
    prompt: input.userPrompt,
    locale,
    breakdown,
  });

  const generated = await tryGenerateRemakePlan({
    video: input.video,
    reference: input.reference,
    prompt: input.userPrompt,
    productImageCount: input.productImageCount,
    creatorImageCount: input.creatorImageCount,
    locale,
    targetDurationSeconds: input.targetDurationSeconds,
    breakdown,
    userScriptText: input.gateOverrides?.scriptText,
    userSellingPoints: input.gateOverrides?.sellingPoints,
    userAudienceTags: input.gateOverrides?.audienceTags,
  });

  const plan = normalizePlan(generated, fallback);

  // Gate 1 重算时把用户确认版钉死成 scriptText，避免 LLM 自作主张改回去
  if (input.gateOverrides?.scriptText) {
    plan.scriptText = input.gateOverrides.scriptText;
  }
  if (input.gateOverrides?.sellingPoints?.length) {
    plan.sellingPoints = input.gateOverrides.sellingPoints;
  }
  if (input.gateOverrides?.audienceTags?.length) {
    plan.audienceTags = input.gateOverrides.audienceTags;
  }

  return { plan, breakdown };
}

/**
 * Job 创建时用 videoId 拿 HotVideoRecord 的一层薄封装。手动链接来源的 job
 * 不需要 video，直接传 null。
 */
export async function resolveReferenceVideo(
  videoId: string | undefined,
  locale: Locale,
): Promise<HotVideoRecord | null> {
  if (!videoId) return null;
  return getHotVideo(videoId, locale);
}
