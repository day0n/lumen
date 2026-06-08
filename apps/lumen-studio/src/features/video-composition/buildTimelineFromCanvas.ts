import type { CompositionTimeline, CompositionTimelineClip } from '@lumen/shared/domain';
import { CompositionTimelineSchema } from '@lumen/shared/domain';
import { nanoid } from 'nanoid';

import type { CanvasEdgeShape, CanvasNodeShape } from '@/lib/canvas/types';

export interface UpstreamVideoSource {
  nodeId: string;
  title: string;
  url: string;
  duration?: number;
}

export function collectUpstreamVideoSources(
  nodeId: string,
  nodes: CanvasNodeShape[],
  edges: CanvasEdgeShape[],
): UpstreamVideoSource[] {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const incoming = edges.filter((edge) => edge.target === nodeId);
  const sources: UpstreamVideoSource[] = [];

  for (const edge of incoming) {
    const source = byId.get(edge.source);
    if (!source || source.data.kind !== 'video') continue;
    const url = source.data.output?.trim();
    if (!url || url.startsWith('blob:')) continue;
    const title =
      typeof source.data.title === 'string' && source.data.title.length > 0
        ? source.data.title
        : source.id.slice(0, 8);
    sources.push({
      nodeId: source.id,
      title,
      url,
    });
  }

  return sources;
}

export function collectUpstreamBgmUrl(
  nodeId: string,
  nodes: CanvasNodeShape[],
  edges: CanvasEdgeShape[],
): string | null {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const edge of edges.filter((item) => item.target === nodeId)) {
    const source = byId.get(edge.source);
    if (!source || source.data.kind !== 'audio') continue;
    const url = source.data.output?.trim();
    if (url && !url.startsWith('blob:')) return url;
  }
  return null;
}

function normalizeOrders(clips: CompositionTimelineClip[]): CompositionTimelineClip[] {
  return clips
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((clip, index) => ({ ...clip, order: index }));
}

export function buildInitialTimeline(
  settings: Record<string, unknown>,
  upstreamVideos: UpstreamVideoSource[],
): CompositionTimeline {
  const existing = CompositionTimelineSchema.safeParse(settings.timeline);
  if (existing.success && existing.data.clips.length > 0) {
    return existing.data;
  }

  const clips: CompositionTimelineClip[] = upstreamVideos.map((source, index) => ({
    id: nanoid(10),
    order: index,
    sourceNodeId: source.nodeId,
    sourceUrlSnapshot: source.url,
    sourceIn: 0,
    duration: Math.max(0.5, source.duration ?? 3),
    volume: 1,
    label: source.title,
  }));

  return CompositionTimelineSchema.parse({
    clips: normalizeOrders(clips),
    aspectRatio: existing.success ? existing.data.aspectRatio : '9:16',
    resolution: existing.success ? existing.data.resolution : '720p',
    bgmVolume: existing.success ? existing.data.bgmVolume : 0.8,
  });
}
