import type { NodeType, WorkflowNode } from '@lumen/shared/domain';

import type { WorkflowGraph } from './graph.js';

export interface ResolvedInput {
  prompt: string;
  image: string | null;
  lastFrameImage: string | null;
  video: string | null;
}

export function resolveInput(graph: WorkflowGraph, nodeId: string): ResolvedInput {
  const node = graph.getNodeAttributes(nodeId) as WorkflowNode;

  const resolved: ResolvedInput = {
    prompt: node.input.prompt,
    image: node.input.image,
    lastFrameImage: node.input.lastFrameImage,
    video: node.input.video,
  };

  for (const predecessorId of graph.inNeighbors(nodeId)) {
    const predecessor = graph.getNodeAttributes(predecessorId) as WorkflowNode;
    const upstreamOutput = predecessor.output;
    if (!upstreamOutput) continue;

    const upstreamType: NodeType = predecessor.type;

    switch (upstreamType) {
      case 'text':
        if (!resolved.prompt) {
          resolved.prompt = upstreamOutput;
        } else {
          resolved.prompt = `${upstreamOutput}\n\n${resolved.prompt}`;
        }
        break;
      case 'image':
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

  return resolved;
}
