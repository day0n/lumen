import { z } from 'zod';
import type { VideoClipInput } from './node.js';

export const CompositionAspectRatioSchema = z.enum(['9:16', '16:9', '1:1', '4:5']);
export type CompositionAspectRatio = z.infer<typeof CompositionAspectRatioSchema>;

export const CompositionResolutionSchema = z.enum(['720p', '1080p']);
export type CompositionResolution = z.infer<typeof CompositionResolutionSchema>;

export const CompositionTimelineClipSchema = z.object({
  id: z.string().trim().min(1),
  order: z.number().finite(),
  sourceNodeId: z.string().trim().min(1).optional(),
  sourceUrlSnapshot: z.string().trim().min(1).optional(),
  sourceIn: z.number().nonnegative().default(0),
  duration: z.number().positive(),
  volume: z.number().min(0).max(1).default(1),
  label: z.string().trim().max(120).optional(),
});
export type CompositionTimelineClip = z.infer<typeof CompositionTimelineClipSchema>;

export const CompositionTimelineSchema = z.object({
  clips: z.array(CompositionTimelineClipSchema).default([]),
  aspectRatio: CompositionAspectRatioSchema.default('9:16'),
  resolution: CompositionResolutionSchema.default('720p'),
  bgmVolume: z.number().min(0).max(1).optional(),
});
export type CompositionTimeline = z.infer<typeof CompositionTimelineSchema>;

export class CompositionCompileError extends Error {
  readonly missingClipIds: string[];

  constructor(missingClipIds: string[]) {
    super(
      missingClipIds.length === 1
        ? `composition clip could not resolve url: ${missingClipIds[0]}`
        : `composition clips could not resolve url: ${missingClipIds.join(', ')}`,
    );
    this.name = 'CompositionCompileError';
    this.missingClipIds = missingClipIds;
  }
}

export type CompositionCompileResult =
  | { ok: true; clips: VideoClipInput[] }
  | { ok: false; missing: string[] };

export function parseCompositionTimeline(settings: Record<string, unknown>): CompositionTimeline | null {
  const raw = settings.timeline;
  if (!raw || typeof raw !== 'object') return null;
  const parsed = CompositionTimelineSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function compileCompositionClips(
  timeline: CompositionTimeline | null,
  videoUrlByNodeId: ReadonlyMap<string, string> | Record<string, string>,
): VideoClipInput[] {
  const result = tryCompileCompositionClips(timeline, videoUrlByNodeId);
  if (!result.ok) throw new CompositionCompileError(result.missing);
  return result.clips;
}

export function tryCompileCompositionClips(
  timeline: CompositionTimeline | null,
  videoUrlByNodeId: ReadonlyMap<string, string> | Record<string, string>,
): CompositionCompileResult {
  if (!timeline || timeline.clips.length === 0) {
    return { ok: false, missing: ['timeline'] };
  }

  const lookup =
    videoUrlByNodeId instanceof Map
      ? videoUrlByNodeId
      : new Map(Object.entries(videoUrlByNodeId));

  const missing: string[] = [];
  const clips: VideoClipInput[] = [];
  const sorted = [...timeline.clips].sort((a, b) => a.order - b.order);

  for (const clip of sorted) {
    const fromNode = clip.sourceNodeId ? lookup.get(clip.sourceNodeId)?.trim() : undefined;
    const url = (fromNode || clip.sourceUrlSnapshot?.trim() || '').trim();
    if (!url) {
      missing.push(clip.sourceNodeId ?? clip.id);
      continue;
    }

    clips.push({
      url,
      start: clip.sourceIn,
      duration: clip.duration,
      volume: clip.volume,
      ...(clip.label ? { title: clip.label } : {}),
    });
  }

  if (missing.length > 0) return { ok: false, missing };
  if (clips.length === 0) return { ok: false, missing: ['timeline'] };
  return { ok: true, clips };
}
