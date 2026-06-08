import assert from 'node:assert/strict';
import test from 'node:test';

import type { WorkflowNode } from '@lumen/shared/domain';

import type { WorkflowGraph } from './graph.js';
import { resolveInput } from './resolver.js';

test('resolveInput maps a single upstream image to video input.image', () => {
  const graph = testGraph([
    imageNode('image-1', 'https://cdn.example.com/input.jpg'),
    videoNode('video-1'),
  ]);

  const input = resolveInput(graph, 'video-1');

  assert.equal(input.image, 'https://cdn.example.com/input.jpg');
  assert.equal(input.lastFrameImage, null);
  assert.deepEqual(input.images, ['https://cdn.example.com/input.jpg']);
});

test('resolveInput maps two upstream images to video first and last frame', () => {
  const graph = testGraph([
    imageNode('image-1', 'https://cdn.example.com/start.jpg'),
    imageNode('image-2', 'https://cdn.example.com/end.jpg'),
    videoNode('video-1'),
  ]);

  const input = resolveInput(graph, 'video-1');

  assert.equal(input.image, 'https://cdn.example.com/start.jpg');
  assert.equal(input.lastFrameImage, 'https://cdn.example.com/end.jpg');
  assert.deepEqual(input.images, [
    'https://cdn.example.com/start.jpg',
    'https://cdn.example.com/end.jpg',
  ]);
});

function testGraph(nodes: WorkflowNode[]): WorkflowGraph {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  return {
    getNodeAttributes(nodeId: string) {
      const node = byId.get(nodeId);
      if (!node) throw new Error(`missing test node: ${nodeId}`);
      return node;
    },
    inNeighbors(nodeId: string) {
      if (nodeId !== 'video-1') return [];
      return nodes.filter((node) => node.type === 'image').map((node) => node.id);
    },
  } as unknown as WorkflowGraph;
}

function imageNode(id: string, output: string): WorkflowNode {
  return {
    id,
    type: 'image',
    position: { x: 0, y: 0 },
    input: emptyInput(),
    output,
    model: { id: 'test-image', settings: {} },
  };
}

function videoNode(id: string): WorkflowNode {
  return {
    id,
    type: 'video',
    position: { x: 0, y: 0 },
    input: emptyInput(),
    output: null,
    model: { id: 'veo-3.1', settings: {} },
  };
}

function emptyInput(): WorkflowNode['input'] {
  return {
    prompt: '',
    image: null,
    lastFrameImage: null,
    images: [],
    video: null,
    videos: [],
    audio: null,
    audios: [],
    clips: [],
  };
}
