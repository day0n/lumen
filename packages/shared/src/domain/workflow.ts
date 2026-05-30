import { z } from 'zod';
import {
  EdgeSchema,
  type ModelConfig,
  NodeInputSchema,
  NodeSchema,
  type NodeType,
  NodeTypeSchema,
} from './node.js';

export const WorkflowModelCatalog = {
  text: [
    { id: 'gemini-3.5-flash', label: 'Gemini 3.5 Flash' },
    { id: 'doubao-seed-2.0-pro', label: 'Doubao Seed 2.0' },
  ],
  image: [
    { id: 'nano-banana2', label: 'Nano Banana 2' },
    { id: 'doubao-seedream-3.0', label: 'Seedream 3.0' },
  ],
  video: [
    { id: 'veo-3.1', label: 'Veo 3.1' },
    { id: 'seedance-1.5-pro', label: 'Seedance 1.5 Pro' },
  ],
  audio: [
    { id: 'fish-tts', label: 'Fish TTS' },
    { id: 'doubao-tts', label: 'Doubao TTS' },
  ],
} as const;

export const LumenCanvasNodeDataSchema = z
  .object({
    kind: NodeTypeSchema,
    title: z.string().default(''),
    prompt: z.string().default(''),
    output: z.string().nullable().default(null),
    modelId: z.string().optional().default(''),
    settings: z.record(z.unknown()).default({}),
    status: z.enum(['idle', 'queued', 'running', 'success', 'error']).default('idle'),
    error: z.string().nullable().optional(),
    groupId: z.string().nullable().optional(),
    groupName: z.string().nullable().optional(),
    progress: z.number().min(0).max(1).optional(),
  })
  .passthrough();
export type LumenCanvasNodeData = z.infer<typeof LumenCanvasNodeDataSchema>;

export const LumenCanvasNodeSchema = z
  .object({
    id: z.string().min(1),
    type: z.string().optional(),
    position: z.object({ x: z.number().finite(), y: z.number().finite() }),
    data: LumenCanvasNodeDataSchema,
  })
  .passthrough();
export type LumenCanvasNode = z.infer<typeof LumenCanvasNodeSchema>;

export const LumenCanvasEdgeSchema = z
  .object({
    id: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    sourceHandle: z.string().nullable().optional(),
    targetHandle: z.string().nullable().optional(),
    type: z.string().optional(),
    data: z.record(z.unknown()).default({}),
  })
  .passthrough();
export type LumenCanvasEdge = z.infer<typeof LumenCanvasEdgeSchema>;

export const LumenCanvasSchema = z
  .object({
    nodes: z.array(LumenCanvasNodeSchema).default([]),
    edges: z.array(LumenCanvasEdgeSchema).default([]),
    viewport: z
      .object({
        x: z.number().finite(),
        y: z.number().finite(),
        zoom: z.number().finite().positive(),
      })
      .optional(),
  })
  .strict();
export type LumenCanvas = z.infer<typeof LumenCanvasSchema>;

export const WorkflowEditInputSchema = z
  .object({
    project_id: z.string().min(1).optional(),
    title: z.string().trim().min(1).max(120).optional(),
    canvas: LumenCanvasSchema,
    allow_destructive_replace: z.boolean().default(false),
    intent: z.string().trim().max(400).optional(),
  })
  .strict();
export type WorkflowEditInput = z.input<typeof WorkflowEditInputSchema>;

export const WorkflowNodeRunInputSchema = z
  .object({
    project_id: z.string().min(1).optional(),
    node_id: z.string().min(1),
  })
  .strict();
export type WorkflowNodeRunInput = z.input<typeof WorkflowNodeRunInputSchema>;

export interface WorkflowEditSummary {
  nodeCount: number;
  edgeCount: number;
  addedNodes: number;
  removedNodes: number;
  changedNodes: number;
  addedEdges: number;
  removedEdges: number;
}

export const MEDIA_TEXT_CONTEXT_CHAR_LIMIT = 1200;

export function getDefaultWorkflowModelId(kind: z.infer<typeof NodeTypeSchema>): string {
  return WorkflowModelCatalog[kind][0]?.id ?? '';
}

export function getSupportedWorkflowModelIds(kind: z.infer<typeof NodeTypeSchema>): string[] {
  return WorkflowModelCatalog[kind].map((model) => model.id);
}

export function normalizeWorkflowCanvas(value: unknown): LumenCanvas {
  return LumenCanvasSchema.parse(value);
}

export function validateWorkflowCanvas(canvas: LumenCanvas): string[] {
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const node of canvas.nodes) {
    if (ids.has(node.id)) errors.push(`duplicate node id: ${node.id}`);
    ids.add(node.id);
    const modelId = resolveCanvasNodeModelId(node);
    if (!getSupportedWorkflowModelIds(node.data.kind).includes(modelId)) {
      errors.push(`node ${node.id} uses unsupported ${node.data.kind} model: ${modelId}`);
    }
  }
  for (const edge of canvas.edges) {
    if (!ids.has(edge.source)) errors.push(`edge ${edge.id} has missing source: ${edge.source}`);
    if (!ids.has(edge.target)) errors.push(`edge ${edge.id} has missing target: ${edge.target}`);
    if (edge.source === edge.target) errors.push(`edge ${edge.id} connects node to itself`);
  }
  errors.push(...detectCycles(canvas));
  return errors;
}

export function summarizeWorkflowEdit(
  before: LumenCanvas | null,
  after: LumenCanvas,
): WorkflowEditSummary {
  const beforeNodeIds = new Set((before?.nodes ?? []).map((node) => node.id));
  const afterNodeIds = new Set(after.nodes.map((node) => node.id));
  const beforeEdgeIds = new Set((before?.edges ?? []).map((edge) => edge.id));
  const afterEdgeIds = new Set(after.edges.map((edge) => edge.id));
  let changedNodes = 0;
  const beforeNodes = new Map((before?.nodes ?? []).map((node) => [node.id, JSON.stringify(node)]));
  for (const node of after.nodes) {
    if (beforeNodeIds.has(node.id) && beforeNodes.get(node.id) !== JSON.stringify(node)) {
      changedNodes += 1;
    }
  }
  return {
    nodeCount: after.nodes.length,
    edgeCount: after.edges.length,
    addedNodes: countAdded(beforeNodeIds, afterNodeIds),
    removedNodes: countAdded(afterNodeIds, beforeNodeIds),
    changedNodes,
    addedEdges: countAdded(beforeEdgeIds, afterEdgeIds),
    removedEdges: countAdded(afterEdgeIds, beforeEdgeIds),
  };
}

export function resolveCanvasNodeModelId(node: LumenCanvasNode): string {
  return node.data.modelId?.trim() || getDefaultWorkflowModelId(node.data.kind);
}

export function canvasNodeToWorkflowNode(node: LumenCanvasNode) {
  const settings = node.data.settings ?? {};
  return NodeSchema.parse({
    id: node.id,
    type: node.data.kind,
    position: node.position,
    output: node.data.output?.trim() ? node.data.output : null,
    input: {
      prompt: node.data.prompt ?? '',
      image: getSettingString(settings, 'inputImage') || null,
      lastFrameImage: getSettingString(settings, 'inputLastFrameImage') || null,
      video: getSettingString(settings, 'inputVideo') || null,
    },
    model: { id: resolveCanvasNodeModelId(node), settings },
  });
}

export function canvasEdgesToWorkflowEdges(edges: LumenCanvasEdge[]) {
  return edges.map((edge) =>
    EdgeSchema.parse({ id: edge.id, source: edge.source, target: edge.target }),
  );
}

export function workflowModelConfigForCanvasNode(node: LumenCanvasNode): ModelConfig {
  return {
    id: resolveCanvasNodeModelId(node),
    settings: node.data.settings ?? {},
  };
}

export function updateCanvasNodeData(
  canvas: LumenCanvas,
  nodeId: string,
  patch: Partial<LumenCanvasNodeData>,
): LumenCanvas {
  return {
    ...canvas,
    nodes: canvas.nodes.map((node) =>
      node.id === nodeId
        ? LumenCanvasNodeSchema.parse({ ...node, data: { ...node.data, ...patch } })
        : node,
    ),
  };
}

export function mergeTextOutputIntoNodePrompt(input: {
  targetKind: NodeType;
  currentPrompt: string;
  upstreamOutput: string;
}): string {
  const upstreamOutput = input.upstreamOutput.trim();
  if (!upstreamOutput) return input.currentPrompt;

  if (input.targetKind === 'image' || input.targetKind === 'video') {
    const context = truncateTextContext(upstreamOutput, MEDIA_TEXT_CONTEXT_CHAR_LIMIT);
    if (!input.currentPrompt.trim()) return context;
    return `${input.currentPrompt}\n\nUpstream text context (for reference only):\n${context}`;
  }

  return input.currentPrompt ? `${upstreamOutput}\n\n${input.currentPrompt}` : upstreamOutput;
}

export function computeSingleNodeInput(canvas: LumenCanvas, nodeId: string) {
  const node = canvas.nodes.find((item) => item.id === nodeId);
  if (!node) throw new Error(`node not found: ${nodeId}`);

  const base = canvasNodeToWorkflowNode(node).input;
  const incoming = canvas.edges.filter((edge) => edge.target === nodeId);
  const missing: string[] = [];
  const byId = new Map(canvas.nodes.map((item) => [item.id, item]));
  const resolved = NodeInputSchema.parse(base);

  for (const edge of incoming) {
    const source = byId.get(edge.source);
    if (!source) {
      missing.push(`${edge.source} (missing node)`);
      continue;
    }
    const output = typeof source.data.output === 'string' ? source.data.output.trim() : '';
    if (!output) {
      missing.push(`${source.id} (${source.data.title || source.data.kind})`);
      continue;
    }
    switch (source.data.kind) {
      case 'text':
        resolved.prompt = mergeTextOutputIntoNodePrompt({
          targetKind: node.data.kind,
          currentPrompt: resolved.prompt,
          upstreamOutput: output,
        });
        break;
      case 'image':
        if (!resolved.image) resolved.image = output;
        else if (!resolved.lastFrameImage && output !== resolved.image)
          resolved.lastFrameImage = output;
        break;
      case 'video':
        if (!resolved.video) resolved.video = output;
        break;
      case 'audio':
        break;
    }
  }

  return { input: resolved, missingInputs: missing };
}

function truncateTextContext(value: string, limit: number): string {
  if (value.length <= limit) return value;
  return `${value.slice(0, limit).trimEnd()}\n...[truncated]`;
}

function getSettingString(settings: Record<string, unknown>, key: string): string {
  const value = settings[key];
  return typeof value === 'string' ? value.trim() : '';
}

function countAdded(before: Set<string>, after: Set<string>): number {
  let count = 0;
  for (const id of after) if (!before.has(id)) count += 1;
  return count;
}

function detectCycles(canvas: LumenCanvas): string[] {
  const adjacency = new Map<string, string[]>();
  for (const node of canvas.nodes) adjacency.set(node.id, []);
  for (const edge of canvas.edges) {
    if (!adjacency.has(edge.source) || !adjacency.has(edge.target)) continue;
    adjacency.get(edge.source)?.push(edge.target);
  }

  const visiting = new Set<string>();
  const visited = new Set<string>();
  const errors: string[] = [];
  const visit = (id: string, path: string[]) => {
    if (visiting.has(id)) {
      errors.push(`cycle detected: ${[...path, id].join(' -> ')}`);
      return;
    }
    if (visited.has(id)) return;
    visiting.add(id);
    for (const next of adjacency.get(id) ?? []) visit(next, [...path, id]);
    visiting.delete(id);
    visited.add(id);
  };
  for (const node of canvas.nodes) visit(node.id, []);
  return errors;
}
