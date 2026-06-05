import {
  type NodeType,
  type VideoClipInput,
  type WorkflowNode,
  mergeTextOutputIntoNodePrompt,
} from '@lumen/shared/domain';

import type { WorkflowGraph } from './graph.js';

export interface ResolvedInput {
  prompt: string;
  image: string | null;
  lastFrameImage: string | null;
  images: string[];
  video: string | null;
  videos: string[];
  audio: string | null;
  audios: string[];
  clips: VideoClipInput[];
}

function uniqueOutputs(outputs: string[]) {
  return outputs.filter((output, index) => output && outputs.indexOf(output) === index);
}

function applyVideoFrameInputs(resolved: ResolvedInput, upstreamImages: string[]) {
  const distinctUpstreamImages = uniqueOutputs(upstreamImages);

  if (!resolved.image && !resolved.lastFrameImage) {
    const [upstreamFirst, upstreamLast] = distinctUpstreamImages;
    if (!upstreamFirst || !upstreamLast) return;
    resolved.image = upstreamFirst;
    resolved.lastFrameImage = upstreamLast;
    return;
  }

  if (resolved.image && !resolved.lastFrameImage) {
    resolved.lastFrameImage =
      distinctUpstreamImages.find((output) => output !== resolved.image) ?? null;
  } else if (!resolved.image && resolved.lastFrameImage) {
    resolved.image =
      distinctUpstreamImages.find((output) => output !== resolved.lastFrameImage) ?? null;
  }
}

export function resolveInput(graph: WorkflowGraph, nodeId: string): ResolvedInput {
  const node = graph.getNodeAttributes(nodeId) as WorkflowNode;

  const resolved: ResolvedInput = {
    prompt: node.input.prompt,
    image: node.input.image,
    lastFrameImage: node.input.lastFrameImage,
    images: [...node.input.images],
    video: node.input.video,
    videos: [...node.input.videos],
    audio: node.input.audio,
    audios: [...node.input.audios],
    clips: [...node.input.clips],
  };
  const upstreamImages: string[] = [];

  for (const predecessorId of graph.inNeighbors(nodeId)) {
    const predecessor = graph.getNodeAttributes(predecessorId) as WorkflowNode;
    const upstreamOutput = predecessor.output;
    if (!upstreamOutput) continue;

    const upstreamType: NodeType = predecessor.type;

    switch (upstreamType) {
      case 'text':
        resolved.prompt = mergeTextOutputIntoNodePrompt({
          targetKind: node.type,
          currentPrompt: resolved.prompt,
          upstreamOutput,
        });
        break;
      case 'image':
        if (!resolved.images.includes(upstreamOutput)) resolved.images.push(upstreamOutput);
        if (node.type === 'video') {
          upstreamImages.push(upstreamOutput);
          break;
        }
        if (!resolved.image) {
          resolved.image = upstreamOutput;
        } else if (!resolved.lastFrameImage && upstreamOutput !== resolved.image) {
          resolved.lastFrameImage = upstreamOutput;
        }
        break;
      case 'video':
        addResolvedVideo(resolved, upstreamOutput);
        break;
      case 'audio':
        addResolvedAudio(resolved, upstreamOutput);
        break;
    }
  }

  if (node.type === 'video') {
    applyVideoFrameInputs(resolved, upstreamImages);
  }

  return resolved;
}

function addResolvedVideo(input: ResolvedInput, url: string) {
  const trimmed = url.trim();
  if (!trimmed) return;
  if (!input.video) input.video = trimmed;
  if (!input.videos.includes(trimmed)) input.videos.push(trimmed);
  if (!input.clips.some((clip) => clip.url === trimmed)) input.clips.push({ url: trimmed });
}

function addResolvedAudio(input: ResolvedInput, url: string) {
  const trimmed = url.trim();
  if (!trimmed) return;
  if (!input.audio) input.audio = trimmed;
  if (!input.audios.includes(trimmed)) input.audios.push(trimmed);
}
