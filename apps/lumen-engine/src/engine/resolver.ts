import {
  type NodeType,
  type WorkflowNode,
  mergeTextOutputIntoNodePrompt,
} from '@lumen/shared/domain';

import type { WorkflowGraph } from './graph.js';

export interface ResolvedInput {
  prompt: string;
  image: string | null;
  lastFrameImage: string | null;
  video: string | null;
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
    video: node.input.video,
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
        if (!resolved.video) resolved.video = upstreamOutput;
        break;
      case 'audio':
        break;
    }
  }

  if (node.type === 'video') {
    applyVideoFrameInputs(resolved, upstreamImages);
  }

  return resolved;
}
