'use client';

import {
  MobileCanvasBottomControls,
  MobileCanvasBottomToolbar,
  MobileCanvasFitView,
} from '@/components/canvas/canvas-mobile';
import { NotificationsPopover } from '@/components/home/NotificationsPopover';
import { MobileSheet } from '@/components/mobile';
import { LumenMark } from '@/components/ui/LumenMark';
import { useIsMobileCanvas } from '@/hooks/use-is-mobile';
import { cn } from '@/lib/cn';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconArrowsExchange2,
  IconCheck,
  IconChevronDown,
  IconChevronLeft,
  IconClock,
  IconExternalLink,
  IconFileText,
  IconFocusCentered,
  IconFolder,
  IconFolderFilled,
  IconGridDots,
  IconHierarchy2,
  IconLayoutGrid,
  IconLoader2,
  IconMusic,
  IconPhoto,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconSelectAll,
  IconShare3,
  IconSparkles,
  IconTrash,
  IconUpload,
  IconVideo,
  IconZoomIn,
  IconZoomOut,
} from '@tabler/icons-react';
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Handle,
  Position,
  ReactFlow,
  ReactFlowProvider,
  SelectionMode,
  ViewportPortal,
  addEdge,
  getBezierPath,
  reconnectEdge,
  useEdgesState,
  useNodeConnections,
  useNodesData,
  useNodesState,
  useOnViewportChange,
  useReactFlow,
  useStoreApi,
} from '@xyflow/react';
import type {
  Connection,
  ConnectionLineComponentProps,
  Edge,
  EdgeProps,
  EdgeTypes,
  Node,
  NodeProps,
  NodeTypes,
  OnConnectEnd,
  OnConnectStart,
  XYPosition,
} from '@xyflow/react';
import { AnimatePresence } from 'motion/react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  ChangeEvent,
  MouseEvent,
  DragEvent as ReactDragEvent,
  KeyboardEvent as ReactKeyboardEvent,
  ReactNode,
} from 'react';

import { CanvasHydrationOverlay } from '@/components/canvas/CanvasHydrationOverlay';
import { ChatPanel } from '@/features/agent-chat/ChatPanel';
import { useWorkflowWs } from '@/features/workflow/use-workflow-ws';
import type { NodeState } from '@/features/workflow/use-workflow-ws';
import { useI18n } from '@/i18n/provider';
import { useLoginRedirect } from '@/lib/auth-redirect';
import { arrangeCanvasNodes } from '@/lib/canvas/auto-layout';
import { checkCycle } from '@/lib/canvas/cycle-detection';
import { canRunSelectedNodes, canRunSingleNode } from '@/lib/canvas/node-run-check';
import type { NodeKind } from '@/lib/canvas/types';

import { ImeTextarea } from './ImeTextarea';

type NodeTemplate = {
  kind: NodeKind;
  title: string;
  icon: typeof IconPlus;
  tone: string;
};

type ModelOption = {
  id: string;
  label: string;
  badges: string[];
};

type LumenNodeData = Record<string, unknown> & {
  kind: NodeKind;
  title: string;
  prompt: string;
  output: string | null;
  modelId: string;
  settings: Record<string, unknown>;
  status: 'idle' | 'queued' | 'running' | 'success' | 'error' | 'cancelled';
  error?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  progress?: number;
  previewAspectRatio?: string;
};

type LumenNode = Node<LumenNodeData, 'lumenNode'>;
type LumenEdge = Edge<Record<string, unknown>, 'lumenSmooth'>;
type CanvasSaveState = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

interface CanvasActions {
  runSingleNode: (nodeId: string) => void;
  cancelNodes: (nodeIds: string[]) => void;
  updateNodeData: (nodeId: string, patch: Partial<LumenNodeData>) => void;
  uploadCanvasMedia: (file: File, kind: MaterialAssetKind, nodeId?: string) => Promise<string>;
  connectionError: string | null;
  canRunNode: (nodeId: string) => boolean;
}

const CanvasActionsContext = createContext<CanvasActions>({
  runSingleNode: () => {},
  cancelNodes: () => {},
  updateNodeData: () => {},
  uploadCanvasMedia: async () => '',
  connectionError: null,
  canRunNode: () => false,
});

type MaterialAssetKind = 'image' | 'video' | 'audio';
type MaterialAssetCategory = 'my_assets' | 'character' | 'scene' | 'item';

type MaterialAssetRecord = {
  id: string;
  category: MaterialAssetCategory;
  kind: MaterialAssetKind;
  title: string;
  url: string;
  thumbnailUrl?: string;
  source: 'workflow_result' | 'user_upload' | 'manual';
  workflowId?: string;
  runId?: string;
  nodeId?: string;
  nodeType?: string;
  contentType?: string;
  size?: number;
  inputPrompt?: string;
  metadata?: {
    subcategory?: string;
    originalName?: string;
    sellingPoints?: string[];
    batchId?: string;
    position?: number;
  };
  createdAt: string;
  updatedAt: string;
};

type MaterialAssetDragPayload = {
  id: string;
  kind: MaterialAssetKind;
  title: string;
  url: string;
  category: MaterialAssetCategory;
  sellingPoints?: string[];
};

type ProjectHistoryRecord = {
  id: string;
  title: string;
  action: 'created' | 'updated' | 'restored';
  canvas?: {
    nodes: LumenNode[];
    edges: LumenEdge[];
  };
  nodeCount: number;
  edgeCount: number;
  createdAt: string;
};

interface CanvasWorkbenchProps {
  projectId?: string;
  createOnMount?: boolean;
}

interface CanvasProjectPayload {
  id: string;
  ownerId: string;
  title: string;
  canvas: {
    nodes: LumenNode[];
    edges: LumenEdge[];
  };
}

type ProjectApiResponse =
  | {
      ok: true;
      data: {
        project: CanvasProjectPayload;
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

type ShareProjectApiResponse =
  | {
      ok: true;
      data: {
        shareUrl: string;
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

type MaterialAssetsApiResponse =
  | {
      ok: true;
      data: {
        assets: MaterialAssetRecord[];
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

type ProjectHistoryApiResponse =
  | {
      ok: true;
      data: {
        history: ProjectHistoryRecord[];
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

type CanvasUploadApiResponse =
  | {
      ok: true;
      data: {
        asset: {
          url: string;
        };
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

type ProjectHistoryRecordApiResponse =
  | {
      ok: true;
      data: {
        history: ProjectHistoryRecord & {
          canvas: {
            nodes: LumenNode[];
            edges: LumenEdge[];
          };
        };
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

const nodeCatalog = [
  {
    kind: 'text',
    title: 'Text',
    icon: IconFileText,
    tone: 'from-[#122033] via-[#1e3d54] to-[#090d13]',
  },
  {
    kind: 'image',
    title: 'Image',
    icon: IconPhoto,
    tone: 'from-[#152036] via-[#27436b] to-[#0d1118]',
  },
  {
    kind: 'video',
    title: 'Video',
    icon: IconVideo,
    tone: 'from-[#14232a] via-[#315567] to-[#0c1116]',
  },
  {
    kind: 'audio',
    title: 'Audio',
    icon: IconMusic,
    tone: 'from-[#171a2d] via-[#2b3c6f] to-[#0e1018]',
  },
] satisfies [NodeTemplate, ...NodeTemplate[]];

const defaultModels: Record<NodeKind, ModelOption[]> = {
  text: [
    {
      id: 'gemini-2.5-flash',
      label: 'Gemini 2.5 Flash',
      badges: ['canvas.models.fast', 'canvas.models.general', '10 ~ 20s'],
    },
    {
      id: 'doubao-seed-2.0-pro',
      label: 'Doubao Seed 2.0',
      badges: ['canvas.models.chineseWriting', 'canvas.models.stable', '10 ~ 20s'],
    },
  ],
  image: [
    {
      id: 'nano-banana2',
      label: 'Nano Banana 2',
      badges: ['canvas.models.realisticImage', 'canvas.models.highQuality', '10 ~ 20s'],
    },
    {
      id: 'doubao-seedream-3.0',
      label: 'Seedream 3.0',
      badges: ['canvas.models.chineseFriendly', 'canvas.models.multiStyle', '10 ~ 20s'],
    },
  ],
  video: [
    {
      id: 'veo-3.1',
      label: 'Veo 3.1',
      badges: ['canvas.models.highQualityVideo', '4K', '60 ~ 120s'],
    },
    {
      id: 'seedance-1.5-pro',
      label: 'Seedance 1.5',
      badges: ['canvas.models.autoEdit', 'canvas.models.dynamic', '30 ~ 90s'],
    },
    {
      id: 'lumen-video-edit',
      label: 'Auto edit',
      badges: ['canvas.models.localEdit', 'canvas.models.multiVideo', '30 ~ 120s'],
    },
  ],
  audio: [
    {
      id: 'fish-tts',
      label: 'Fish TTS',
      badges: ['canvas.models.naturalVoice', 'canvas.models.multilingual', '5 ~ 10s'],
    },
    {
      id: 'doubao-tts',
      label: 'Doubao TTS',
      badges: ['canvas.models.chineseVoice', 'canvas.models.quick', '5 ~ 10s'],
    },
    {
      id: 'suno-music',
      label: 'Suno Music',
      badges: ['canvas.models.music', 'Suno', '60 ~ 180s'],
    },
  ],
};

const legacyNodeTitles: Record<NodeKind, string> = {
  text: '文本节点',
  image: '图片节点',
  video: '视频节点',
  audio: '音频节点',
};

const aspectRatioOptions = ['1:1', '4:5', '16:9', '9:16'] as const;

const videoDurationOptions = [4, 6, 8] as const;
const videoResolutionOptions = ['720p', '1080p', '4k'] as const;
const editVideoResolutionOptions = ['720p', '1080p'] as const;
const MATERIAL_ASSET_DRAG_TYPE = 'application/x-lumen-material-asset';
// 1080p / 4k 仅支持 8s（Veo 约束）
const resolutionRequiresEightSeconds = (resolution: string) =>
  resolution === '1080p' || resolution === '4k';

const compatibleTargetKinds: Record<NodeKind, NodeKind[]> = {
  text: ['text', 'image', 'video', 'audio'],
  image: ['text', 'image', 'video'],
  video: ['text', 'video'],
  audio: ['text', 'video', 'audio'],
};

function createNodeData(template: NodeTemplate): LumenNodeData {
  return {
    kind: template.kind,
    title: template.title,
    prompt: '',
    output: null,
    modelId: getDefaultModelId(template.kind),
    settings: {},
    status: 'idle',
    error: null,
    progress: 0,
  };
}

function withCanvasNodeLayering(nodes: LumenNode[]) {
  return nodes.map((node) => ({
    ...node,
    zIndex: node.zIndex ?? 20,
  }));
}

function withCanvasEdgeLayering(edges: LumenEdge[]) {
  return edges.map((edge) => ({
    ...edge,
    zIndex: 0,
  }));
}

function createEdge(source: string, target: string, connection?: Partial<Connection>): LumenEdge {
  return {
    id: `${source}-${target}-${Date.now()}-${Math.round(Math.random() * 9999)}`,
    source,
    target,
    sourceHandle: connection?.sourceHandle,
    targetHandle: connection?.targetHandle,
    type: 'lumenSmooth',
    selectable: true,
    reconnectable: true,
    zIndex: 0,
    data: {},
  };
}

function getTemplate(kind: NodeKind): NodeTemplate {
  return nodeCatalog.find((template) => template.kind === kind) ?? nodeCatalog[0];
}

function getDefaultModelId(kind: NodeKind) {
  return defaultModels[kind][0]?.id ?? '';
}

function resolveModelId(data: LumenNodeData) {
  return data.modelId || getDefaultModelId(data.kind);
}

function getSettingString(settings: Record<string, unknown>, key: string) {
  const value = settings[key];
  return typeof value === 'string' ? value : '';
}

function isBlobUrl(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith('blob:');
}

function stripTransientCanvasValue(value: unknown): unknown {
  if (isBlobUrl(value)) return '';
  if (Array.isArray(value)) {
    return value.map(stripTransientCanvasValue).filter((item) => item !== '');
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .map(([key, item]) => [key, stripTransientCanvasValue(item)] as const)
        .filter(([, item]) => item !== ''),
    );
  }
  return value;
}

function getSettingStringArray(settings: Record<string, unknown>, key: string) {
  const value = settings[key];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function getSettingVideoClips(settings: Record<string, unknown>) {
  const value = settings.inputClips ?? settings.clips;
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== 'object') return null;
      const record = item as Record<string, unknown>;
      const url = typeof record.url === 'string' ? record.url.trim() : '';
      if (!url) return null;
      return {
        url,
        start: getOptionalNumber(record.start),
        duration: getOptionalNumber(record.duration),
        volume: getOptionalNumber(record.volume),
        title: typeof record.title === 'string' ? record.title.trim() : undefined,
      };
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));
}

function getOptionalNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function getAspectRatio(settings: Record<string, unknown>) {
  const value =
    getSettingString(settings, 'aspectRatio') || getSettingString(settings, 'aspect_ratio');
  return isSupportedAspectRatio(value) ? value : '16:9';
}

function isSupportedAspectRatio(value: string): value is (typeof aspectRatioOptions)[number] {
  return aspectRatioOptions.includes(value as (typeof aspectRatioOptions)[number]);
}

function getVideoDuration(
  settings: Record<string, unknown>,
): (typeof videoDurationOptions)[number] {
  const raw = settings.duration;
  const value = typeof raw === 'number' ? raw : Number(raw);
  return videoDurationOptions.includes(value as (typeof videoDurationOptions)[number])
    ? (value as (typeof videoDurationOptions)[number])
    : 8;
}

function getVideoResolution(
  settings: Record<string, unknown>,
): (typeof videoResolutionOptions)[number] {
  const value = getSettingString(settings, 'resolution');
  return videoResolutionOptions.includes(value as (typeof videoResolutionOptions)[number])
    ? (value as (typeof videoResolutionOptions)[number])
    : '720p';
}

// 与 engine/resolver.ts 的图片合并逻辑保持一致：手动上传优先，上游图片必须成对出现才填入首/尾帧。
function resolveFrames(inputImage: string, inputLastFrameImage: string, upstreamImages: string[]) {
  let first = inputImage;
  let last = inputLastFrameImage;

  const distinctUpstreamImages = upstreamImages.filter(
    (output, index) => output && upstreamImages.indexOf(output) === index,
  );

  if (!first && !last) {
    const [upstreamFirst, upstreamLast] = distinctUpstreamImages;
    if (!upstreamFirst || !upstreamLast) return { first: '', last: '' };
    return { first: upstreamFirst, last: upstreamLast };
  }

  if (first && !last) {
    last = distinctUpstreamImages.find((output) => output !== first) ?? '';
  } else if (!first && last) {
    first = distinctUpstreamImages.find((output) => output !== last) ?? '';
  }

  return { first, last };
}

function getNodeTitle(
  data: LumenNodeData,
  t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string,
) {
  const template = getTemplate(data.kind);
  if (!data.title || data.title === legacyNodeTitles[data.kind]) {
    return t(`canvas.nodeKinds.${data.kind}`);
  }

  return data.title === template.title ? t(`canvas.nodeKinds.${data.kind}`) : data.title;
}

function isWorkflowNodeBusy(status?: LumenNodeData['status']) {
  return status === 'queued' || status === 'running';
}

function getNodeOutputCount(node: LumenNode | undefined) {
  const output = node?.data.output?.trim();
  return output && !isBlobUrl(output) ? 1 : 0;
}

function withCanvasOutputMetrics(nodes: LumenNode[], edges: LumenEdge[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const incomingByTarget = new Map<string, LumenEdge[]>();
  const outgoingBySource = new Map<string, LumenEdge[]>();

  for (const edge of edges) {
    const incoming = incomingByTarget.get(edge.target) ?? [];
    incoming.push(edge);
    incomingByTarget.set(edge.target, incoming);

    const outgoing = outgoingBySource.get(edge.source) ?? [];
    outgoing.push(edge);
    outgoingBySource.set(edge.source, outgoing);
  }

  const countUpstreamOutputs = (nodeId: string, visited = new Set<string>()): number => {
    const incoming = incomingByTarget.get(nodeId) ?? [];
    let count = 0;

    for (const edge of incoming) {
      if (visited.has(edge.source)) continue;
      visited.add(edge.source);
      const source = nodeById.get(edge.source);
      count += getNodeOutputCount(source);
      count += countUpstreamOutputs(edge.source, visited);
    }

    return count;
  };

  return {
    nodes: nodes.map((node) => ({
      ...node,
      data: {
        ...node.data,
        outputCount: getNodeOutputCount(node),
        previewAspectRatio:
          node.data.kind === 'image'
            ? (findDownstreamVideoAspectRatio(node.id, nodeById, outgoingBySource) ??
              getAspectRatio(node.data.settings))
            : node.data.kind === 'video'
              ? getAspectRatio(node.data.settings)
              : undefined,
        upstreamOutputCount: countUpstreamOutputs(node.id),
      },
    })),
    edges: edges.map((edge) => {
      const source = nodeById.get(edge.source);
      return {
        ...edge,
        data: {
          ...(edge.data ?? {}),
          sourceKind: source?.data.kind ?? null,
          sourceOutputCount: getNodeOutputCount(source),
        },
      };
    }),
  };
}

function findDownstreamVideoAspectRatio(
  nodeId: string,
  nodeById: Map<string, LumenNode>,
  outgoingBySource: Map<string, LumenEdge[]>,
) {
  const queue = [...(outgoingBySource.get(nodeId) ?? []).map((edge) => edge.target)];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const nextId = queue.shift();
    if (!nextId || visited.has(nextId)) continue;
    visited.add(nextId);

    const node = nodeById.get(nextId);
    if (!node) continue;
    if (node.data.kind === 'video') return getAspectRatio(node.data.settings);
    for (const edge of outgoingBySource.get(nextId) ?? []) queue.push(edge.target);
  }

  return null;
}

function canConnectNodeKinds(sourceKind: NodeKind, targetKind: NodeKind) {
  return compatibleTargetKinds[sourceKind].includes(targetKind);
}

function materialAssetKindToNodeKind(kind: MaterialAssetKind): NodeKind {
  switch (kind) {
    case 'image':
      return 'image';
    case 'video':
      return 'video';
    case 'audio':
      return 'audio';
  }
}

function materialAssetPrompt(asset: MaterialAssetDragPayload) {
  const points = asset.sellingPoints?.filter(Boolean) ?? [];
  if (points.length === 0) return asset.title;
  return [asset.title, ...points.map((point) => `- ${point}`)].join('\n');
}

function toMaterialAssetDragPayload(asset: MaterialAssetRecord): MaterialAssetDragPayload {
  return {
    id: asset.id,
    kind: asset.kind,
    title: asset.title,
    url: asset.url,
    category: asset.category,
    ...(asset.metadata?.sellingPoints?.length
      ? { sellingPoints: asset.metadata.sellingPoints }
      : {}),
  };
}

function readMaterialAssetDragPayload(dataTransfer: DataTransfer): MaterialAssetDragPayload | null {
  const raw = dataTransfer.getData(MATERIAL_ASSET_DRAG_TYPE);
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<MaterialAssetDragPayload>;
    if (
      !value.id ||
      !value.url ||
      !value.title ||
      !value.category ||
      (value.kind !== 'image' && value.kind !== 'video' && value.kind !== 'audio')
    ) {
      return null;
    }
    return {
      id: value.id,
      kind: value.kind,
      title: value.title,
      url: value.url,
      category: value.category,
      ...(value.sellingPoints?.length ? { sellingPoints: value.sellingPoints } : {}),
    };
  } catch {
    return null;
  }
}

function toWorkflowNodes(nodes: LumenNode[], edges: LumenEdge[]) {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const outgoingBySource = new Map<string, LumenEdge[]>();
  for (const edge of edges) {
    const outgoing = outgoingBySource.get(edge.source) ?? [];
    outgoing.push(edge);
    outgoingBySource.set(edge.source, outgoing);
  }

  return nodes.map((node) => {
    const inputImage = getSettingString(node.data.settings, 'inputImage');
    const inputLastFrameImage = getSettingString(node.data.settings, 'inputLastFrameImage');
    const inputVideo = getSettingString(node.data.settings, 'inputVideo');
    const inputAudio = getSettingString(node.data.settings, 'inputAudio');
    const inheritedAspectRatio =
      node.data.kind === 'image'
        ? findDownstreamVideoAspectRatio(node.id, nodeById, outgoingBySource)
        : null;
    const settings = inheritedAspectRatio
      ? {
          ...node.data.settings,
          aspectRatio: inheritedAspectRatio,
          aspect_ratio: inheritedAspectRatio,
        }
      : node.data.settings;

    return {
      id: node.id,
      type: node.data.kind,
      position: node.position,
      output: node.data.output?.trim() && !isBlobUrl(node.data.output) ? node.data.output : null,
      input: {
        prompt: node.data.prompt,
        image: inputImage && !isBlobUrl(inputImage) ? inputImage : null,
        lastFrameImage:
          inputLastFrameImage && !isBlobUrl(inputLastFrameImage) ? inputLastFrameImage : null,
        images: getSettingStringArray(node.data.settings, 'inputImages').filter(
          (url) => !isBlobUrl(url),
        ),
        video: inputVideo && !isBlobUrl(inputVideo) ? inputVideo : null,
        videos: getSettingStringArray(node.data.settings, 'inputVideos').filter(
          (url) => !isBlobUrl(url),
        ),
        audio: inputAudio && !isBlobUrl(inputAudio) ? inputAudio : null,
        audios: getSettingStringArray(node.data.settings, 'inputAudios').filter(
          (url) => !isBlobUrl(url),
        ),
        clips: getSettingVideoClips(node.data.settings).filter((clip) => !isBlobUrl(clip.url)),
      },
      model: { id: resolveModelId(node.data), settings },
    };
  });
}

function toWorkflowEdges(edges: LumenEdge[]) {
  return edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
  }));
}

function getNodeSize(node: LumenNode) {
  const measured = node.measured;
  if (measured?.width !== undefined && measured.height !== undefined) {
    return { width: measured.width, height: measured.height };
  }

  if (node.width !== undefined && node.height !== undefined) {
    return { width: node.width, height: node.height };
  }

  switch (node.data.kind) {
    case 'video':
      return { width: 420, height: 430 };
    case 'text':
      return { width: 390, height: 395 };
    case 'image':
      return { width: 380, height: 405 };
    case 'audio':
      return { width: 360, height: 385 };
  }
}

function getNodeBounds(nodes: LumenNode[], padding = 24) {
  if (nodes.length === 0) return null;

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  for (const node of nodes) {
    const size = getNodeSize(node);
    minX = Math.min(minX, node.position.x);
    minY = Math.min(minY, node.position.y);
    maxX = Math.max(maxX, node.position.x + size.width);
    maxY = Math.max(maxY, node.position.y + size.height);
  }

  return {
    x: minX - padding,
    y: minY - padding,
    width: maxX - minX + padding * 2,
    height: maxY - minY + padding * 2,
  };
}

function getGroupedNodeIds(nodes: LumenNode[], groupId: string) {
  return nodes.filter((node) => node.data.groupId === groupId).map((node) => node.id);
}

function canCreateConnection(
  connection: Connection | LumenEdge,
  nodes: LumenNode[],
  edges: LumenEdge[],
) {
  if (!connection.source || !connection.target) return false;
  const sourceNode = nodes.find((node) => node.id === connection.source);
  const targetNode = nodes.find((node) => node.id === connection.target);
  if (!sourceNode || !targetNode || sourceNode.id === targetNode.id) return false;
  if (!canConnectNodeKinds(sourceNode.data.kind, targetNode.data.kind)) return false;
  if (checkCycle(edges, { source: connection.source, target: connection.target })) {
    return false;
  }
  return true;
}

function hasEquivalentEdge(edges: LumenEdge[], connection: Connection) {
  return edges.some(
    (edge) =>
      edge.source === connection.source &&
      edge.target === connection.target &&
      (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null) &&
      (edge.targetHandle ?? null) === (connection.targetHandle ?? null),
  );
}

function withCurrentAppRoutePrefix(localizedPath: string) {
  if (typeof window === 'undefined') return localizedPath;
  const { pathname } = window.location;
  const appPrefix =
    pathname === '/zh/app' || pathname.startsWith('/zh/app/')
      ? '/zh/app'
      : pathname === '/app' || pathname.startsWith('/app/')
        ? '/app'
        : null;
  if (!appPrefix) return localizedPath;
  const appPath = localizedPath.startsWith('/zh/') ? localizedPath.slice(3) : localizedPath;
  return `${appPrefix}${appPath.startsWith('/') ? appPath : `/${appPath}`}`;
}

function readCanvasEntrySearchParam(
  searchParams: URLSearchParams | null | undefined,
  key: string,
) {
  const routedValue = searchParams?.get(key);
  if (routedValue) return routedValue;
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(key);
}

export function CanvasWorkbench({ projectId, createOnMount = false }: CanvasWorkbenchProps) {
  return (
    <ReactFlowProvider>
      <CanvasWorkbenchInner createOnMount={createOnMount} projectId={projectId} />
    </ReactFlowProvider>
  );
}

function CanvasWorkbenchInner({ projectId, createOnMount }: CanvasWorkbenchProps) {
  const isMobileCanvas = useIsMobileCanvas();
  const searchParams = useSearchParams();
  const { locale, t, localePath } = useI18n();
  const { isLoaded: authReady, isSignedIn, requireLogin } = useLoginRedirect();
  const [initialPrompt] = useState(() => readCanvasEntrySearchParam(searchParams, 'prompt'));
  const [agentChatParam] = useState(() => readCanvasEntrySearchParam(searchParams, 'agent'));
  const shouldOpenAgentChat = agentChatParam !== 'closed';
  const [activeKind, setActiveKind] = useState<NodeKind>('text');
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const [materialPanelOpen, setMaterialPanelOpen] = useState(false);
  const [historyPanelOpen, setHistoryPanelOpen] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState(projectId ?? null);
  const [currentOwnerId, setCurrentOwnerId] = useState<string | null>(null);
  const [projectTitle, setProjectTitle] = useState(() => t('canvas.untitled'));
  const [saveState, setSaveState] = useState<CanvasSaveState>(projectId ? 'loading' : 'idle');
  const [nodes, setNodes, onNodesChange] = useNodesState<LumenNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<LumenEdge>([]);
  const reactFlow = useReactFlow<LumenNode, LumenEdge>();
  const reactFlowStore = useStoreApi<LumenNode, LumenEdge>();
  const hasRequestedCreate = useRef(false);
  const hasHydratedProject = useRef(!projectId && !createOnMount);
  // 当 createOnMount 流程刚刚把项目存到服务器并切换到带 id 的 URL 时，
  // 我们不希望随之触发的 load effect 再去 GET 一遍同一份数据：
  // 数据已经是最新的，重新拉一次会让 saveState 闪一下 "loading"，并且打断 hydration overlay 的淡出。
  const skipNextLoadAfterCreateRef = useRef(false);
  // 初次进入存量画布或新画布时，先盖一层全屏加载动画，等节点真正落到 ReactFlow 上之后再淡出，
  // 避免出现「点进去先看到空白画布，几百毫秒后节点才跳出来」的割裂感。
  const [isCanvasHydrated, setIsCanvasHydrated] = useState(!projectId && !createOnMount);
  // 等 React 把节点 commit、ReactFlow 完成 fitView 后再揭示画布。两层 rAF 经验上够覆盖绝大多数情况。
  const markCanvasHydrated = useCallback(() => {
    if (typeof window === 'undefined') {
      setIsCanvasHydrated(true);
      return;
    }
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        setIsCanvasHydrated(true);
      });
    });
  }, []);
  const lastSavedCanvas = useRef('');
  const pendingCanvasUploads = useRef(0);
  const [canvasMediaUploading, setCanvasMediaUploading] = useState(false);
  const selectedElementCount = useMemo(
    () =>
      nodes.filter((node) => node.selected).length + edges.filter((edge) => edge.selected).length,
    [edges, nodes],
  );
  const selectedNodes = useMemo(() => nodes.filter((node) => node.selected), [nodes]);
  const selectedNodeBounds = useMemo(() => getNodeBounds(selectedNodes, 20), [selectedNodes]);
  const nodeGroups = useMemo(() => {
    const grouped = new Map<string, LumenNode[]>();
    for (const node of nodes) {
      if (!node.data.groupId) continue;
      const current = grouped.get(node.data.groupId) ?? [];
      current.push(node);
      grouped.set(node.data.groupId, current);
    }

    return Array.from(grouped.entries())
      .filter(([, groupNodes]) => groupNodes.length >= 2)
      .map(([id, groupNodes]) => ({
        id,
        name: groupNodes[0]?.data.groupName || t('canvas.group'),
        nodes: groupNodes,
        bounds: getNodeBounds(groupNodes, 20),
        selected: groupNodes.some((node) => node.selected),
        running: groupNodes.some((node) => isWorkflowNodeBusy(node.data.status)),
        canRun: canRunSelectedNodes({
          selectedIds: groupNodes.map((node) => node.id),
          nodes,
          edges,
        }),
      }))
      .filter((group) => group.bounds);
  }, [edges, nodes, t]);
  const runnableNodeIds = useMemo(() => {
    const result = new Set<string>();
    for (const node of nodes) {
      if (canRunSingleNode({ id: node.id, nodes, edges })) result.add(node.id);
    }
    return result;
  }, [edges, nodes]);
  const canRunNode = useCallback(
    (nodeId: string) => runnableNodeIds.has(nodeId),
    [runnableNodeIds],
  );
  const { nodes: displayNodes, edges: displayEdges } = useMemo(
    () => withCanvasOutputMetrics(nodes, edges),
    [edges, nodes],
  );
  const ungroupedSelectionBounds = useMemo(() => {
    if (selectedNodes.length < 2) return null;
    const selectedGroupIds = new Set(
      selectedNodes.map((node) => node.data.groupId).filter(Boolean),
    );
    if (selectedGroupIds.size === 1 && selectedNodes.every((node) => node.data.groupId))
      return null;
    return selectedNodeBounds;
  }, [selectedNodeBounds, selectedNodes]);

  const nodeTypes = useMemo<NodeTypes>(() => ({ lumenNode: LumenFlowNode }), []);
  const edgeTypes = useMemo<EdgeTypes>(() => ({ lumenSmooth: LumenSmoothEdge }), []);

  const wsUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/flow`;
  }, []);

  const handleNodeStateChange = useCallback(
    (nodeId: string, state: NodeState) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (node.id !== nodeId) return node;
          return {
            ...node,
            data: {
              ...node.data,
              status: state.status,
              output: state.output ?? node.data.output,
              error: state.error,
              progress: state.progress,
            },
          };
        }),
      );
    },
    [setNodes],
  );

  const { cancelNodes, connectionError, runNodes } = useWorkflowWs({
    url: wsUrl,
    projectId: currentProjectId,
    workflowId: currentProjectId,
    userId: currentOwnerId,
    locale,
    onNodeStateChange: handleNodeStateChange,
  });

  const runSingleNode = useCallback(
    (nodeId: string) => {
      runNodes([nodeId], toWorkflowNodes(nodes, edges), toWorkflowEdges(edges));
    },
    [nodes, edges, runNodes],
  );

  const runGroup = useCallback(
    (groupId: string) => {
      const nodeIds = getGroupedNodeIds(nodes, groupId);
      if (nodeIds.length === 0) return;
      runNodes(nodeIds, toWorkflowNodes(nodes, edges), toWorkflowEdges(edges));
    },
    [nodes, edges, runNodes],
  );

  const cancelGroup = useCallback(
    (groupId: string) => {
      const nodeIds = getGroupedNodeIds(nodes, groupId);
      if (nodeIds.length === 0) return;
      if (!window.confirm(t('canvas.node.cancelConfirm'))) return;
      cancelNodes(nodeIds);
    },
    [cancelNodes, nodes, t],
  );

  const groupSelectedNodes = useCallback(() => {
    if (selectedNodes.length < 2) return;
    const groupId = `group-${Date.now()}-${Math.round(Math.random() * 9999)}`;
    setNodes((currentNodes) =>
      currentNodes.map((node) => {
        if (!node.selected) return node;
        return {
          ...node,
          data: {
            ...node.data,
            groupId,
            groupName: t('canvas.group'),
          },
        };
      }),
    );
  }, [selectedNodes.length, setNodes, t]);

  const ungroupNodes = useCallback(
    (groupId: string) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (node.data.groupId !== groupId) return node;
          return {
            ...node,
            data: {
              ...node.data,
              groupId: null,
              groupName: null,
            },
          };
        }),
      );
    },
    [setNodes],
  );

  const updateNodeData = useCallback(
    (nodeId: string, patch: Partial<LumenNodeData>) => {
      setNodes((currentNodes) =>
        currentNodes.map((node) => {
          if (node.id !== nodeId) return node;
          return { ...node, data: { ...node.data, ...patch } };
        }),
      );
    },
    [setNodes],
  );

  const uploadCanvasMedia = useCallback(
    async (file: File, kind: MaterialAssetKind, nodeId?: string) => {
      pendingCanvasUploads.current += 1;
      setCanvasMediaUploading(true);

      try {
        const form = new FormData();
        form.set('file', file);
        form.set('kind', kind);
        if (currentProjectId) form.set('workflowId', currentProjectId);
        if (nodeId) form.set('nodeId', nodeId);

        const response = await fetch('/api/canvas/uploads', {
          method: 'POST',
          headers: { 'x-lumen-locale': locale },
          body: form,
        });
        const payload = (await response.json()) as CanvasUploadApiResponse;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.ok ? t('materials.uploadFailed') : payload.error.message);
        }
        return payload.data.asset.url;
      } finally {
        pendingCanvasUploads.current = Math.max(0, pendingCanvasUploads.current - 1);
        if (pendingCanvasUploads.current === 0) setCanvasMediaUploading(false);
      }
    },
    [currentProjectId, locale, t],
  );

  useEffect(() => {
    if (!authReady || isSignedIn) return;
    requireLogin();
  }, [authReady, isSignedIn, requireLogin]);

  const refreshProject = useCallback(
    async (options: { signal?: AbortSignal; silent?: boolean } = {}) => {
      if (!currentProjectId) return null;
      if (!options.silent) setSaveState('loading');

      const response = await fetch(`/api/projects/${currentProjectId}`, {
        signal: options.signal,
        headers: { 'x-lumen-locale': locale },
      });
      const project = await readProjectResponse(response, t('canvas.projectFailed'));
      setCurrentOwnerId(project.ownerId);
      setProjectTitle(project.title);
      setNodes(withCanvasNodeLayering(project.canvas.nodes));
      setEdges(withCanvasEdgeLayering(project.canvas.edges));
      lastSavedCanvas.current = JSON.stringify(project.canvas);
      hasHydratedProject.current = true;
      setSaveState('saved');
      return project;
    },
    [currentProjectId, locale, setEdges, setNodes, t],
  );

  const handleAgentWorkflowUpdate = useCallback(
    async (data: Record<string, unknown>) => {
      const eventProjectId = readEventString(data.project_id);
      if (!currentProjectId || eventProjectId !== currentProjectId) return;
      try {
        const project = await refreshProject({ silent: true });
        if (project && readEventString(data.reason) === 'write_canvas') {
          // agent 改写画布结构后基于刚拉到的 nodes/edges 算布局，
          // 不读 reactFlow.getEdges() 以避开 React/Flow 内部 store 的同步时机。
          const arranged = arrangeCanvasNodes(
            withCanvasNodeLayering(project.canvas.nodes),
            project.canvas.edges,
          );
          setNodes(arranged);
          window.requestAnimationFrame(() => {
            reactFlow.fitView({ padding: 0.28, duration: 320, maxZoom: 1 });
          });
        }
      } catch (error) {
        console.error(error);
        setSaveState('error');
      }
    },
    [currentProjectId, reactFlow, refreshProject, setNodes],
  );

  const handleAgentWorkflowNodeStatus = useCallback(
    (data: Record<string, unknown>) => {
      const eventProjectId = readEventString(data.project_id);
      const nodeId = readEventString(data.node_id);
      const status = readNodeStatus(data.status);
      if (!currentProjectId || eventProjectId !== currentProjectId || !nodeId || !status) return;
      handleNodeStateChange(nodeId, {
        status,
        output: readEventString(data.output),
        error: readEventString(data.error),
        progress: readEventNumber(data.progress) ?? (status === 'success' ? 1 : 0),
      });
    },
    [currentProjectId, handleNodeStateChange],
  );

  useEffect(() => {
    if (
      !createOnMount ||
      currentProjectId ||
      hasRequestedCreate.current ||
      !authReady ||
      !isSignedIn
    ) {
      return;
    }

    hasRequestedCreate.current = true;
    setSaveState('loading');

    const controller = new AbortController();
    const canvas = serializeCanvas(nodes, edges);

    async function createProject() {
      try {
        const response = await fetch('/api/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-lumen-locale': locale },
          body: JSON.stringify({
            title: projectTitle,
            canvas,
          }),
          signal: controller.signal,
        });
        const project = await readProjectResponse(response, t('canvas.projectFailed'));
        skipNextLoadAfterCreateRef.current = true;
        setCurrentProjectId(project.id);
        setCurrentOwnerId(project.ownerId);
        setProjectTitle(project.title);
        setNodes(withCanvasNodeLayering(project.canvas.nodes));
        setEdges(withCanvasEdgeLayering(project.canvas.edges));
        lastSavedCanvas.current = JSON.stringify(project.canvas);
        hasHydratedProject.current = true;
        setSaveState('saved');
        markCanvasHydrated();
        const queryParams = new URLSearchParams();
        if (initialPrompt) queryParams.set('prompt', initialPrompt);
        if (agentChatParam) queryParams.set('agent', agentChatParam);
        const query = queryParams.toString();
        // 用 history.replaceState 取代 router.replace：
        // 后者会触发 Next.js 完整路由切换，导致 loading.tsx 再现一次 + workbench 重挂载，
        // 视觉上就是「加载图 → 空画布 → 加载图 → 真画布」的双闪。
        // 我们已经把项目数据写到内部 state 里了，这里只需要把地址栏对齐到真实项目地址。
        // SPA 入口要保留 /app 前缀，避免后续清理 query 时退回旧的 /canvas/new。
        if (typeof window !== 'undefined') {
          const nextUrl = withCurrentAppRoutePrefix(
            localePath(`/canvas/${project.id}${query ? `?${query}` : ''}`),
          );
          window.history.replaceState(window.history.state, '', nextUrl);
        }
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        console.error(error);
        setSaveState('error');
        setIsCanvasHydrated(true);
      }
    }

    void createProject();
    return () => {
      controller.abort();
      hasRequestedCreate.current = false;
    };
  }, [
    authReady,
    createOnMount,
    currentProjectId,
    edges,
    agentChatParam,
    initialPrompt,
    locale,
    localePath,
    markCanvasHydrated,
    nodes,
    projectTitle,
    setEdges,
    setNodes,
    isSignedIn,
    t,
  ]);

  useEffect(() => {
    if (!currentProjectId || !authReady || !isSignedIn) {
      return;
    }

    // createOnMount 流程刚刚把刚建好的项目写进 state（包括 nodes / edges / saveState），
    // hydration overlay 也已经在创建分支里 markCanvasHydrated() 过了，无需再 GET 一遍同一份数据。
    // 这里把标记重置后 return，让用户后续手动切换 / 刷新页面时仍走正常的 load 路径。
    if (skipNextLoadAfterCreateRef.current) {
      skipNextLoadAfterCreateRef.current = false;
      return;
    }

    const controller = new AbortController();
    hasHydratedProject.current = false;
    setSaveState('loading');

    async function loadProject() {
      try {
        await refreshProject({ signal: controller.signal });
        if (!controller.signal.aborted) {
          markCanvasHydrated();
        }
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(error);
          setSaveState('error');
          // 即使出错也要把 overlay 关掉，否则用户被困在加载动画里看不到错误提示。
          setIsCanvasHydrated(true);
        }
      }
    }

    void loadProject();
    return () => controller.abort();
  }, [authReady, currentProjectId, isSignedIn, markCanvasHydrated, refreshProject]);

  useEffect(() => {
    if (
      !currentProjectId ||
      !hasHydratedProject.current ||
      !authReady ||
      !isSignedIn ||
      canvasMediaUploading
    ) {
      return;
    }

    const canvas = serializeCanvas(nodes, edges);
    const serializedCanvas = JSON.stringify(canvas);
    if (serializedCanvas === lastSavedCanvas.current) {
      return;
    }

    setSaveState('saving');
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/projects/${currentProjectId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', 'x-lumen-locale': locale },
          body: JSON.stringify({ canvas }),
          signal: controller.signal,
        });
        const project = await readProjectResponse(response, t('canvas.projectFailed'));
        lastSavedCanvas.current = JSON.stringify(project.canvas);
        setSaveState('saved');
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(error);
          setSaveState('error');
        }
      }
    }, 700);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [authReady, canvasMediaUploading, currentProjectId, edges, isSignedIn, locale, nodes, t]);

  const addCanvasNode = useCallback(
    (template = getTemplate(activeKind), position?: XYPosition) => {
      const fallbackPosition =
        position ??
        reactFlow.screenToFlowPosition({
          x: window.innerWidth / 2 + Math.random() * 180 - 90,
          y: window.innerHeight / 2 + Math.random() * 140 - 30,
        });

      const nextNode: LumenNode = {
        id: `${template.kind}-${Date.now()}-${Math.round(Math.random() * 9999)}`,
        type: 'lumenNode',
        position: fallbackPosition,
        zIndex: 20,
        data: createNodeData(template),
      };

      setNodes((currentNodes) => [...currentNodes, nextNode]);
    },
    [activeKind, reactFlow, setNodes],
  );

  const addMaterialAssetNode = useCallback(
    (asset: MaterialAssetDragPayload, position: XYPosition) => {
      const kind = materialAssetKindToNodeKind(asset.kind);
      const template = getTemplate(kind);
      const nextNode: LumenNode = {
        id: `${kind}-${Date.now()}-${Math.round(Math.random() * 9999)}`,
        type: 'lumenNode',
        position,
        selected: true,
        zIndex: 20,
        data: {
          ...createNodeData(template),
          title: asset.title || template.title,
          prompt: materialAssetPrompt(asset),
          output: asset.url,
          status: 'success',
          progress: 1,
        },
      };

      setNodes((currentNodes) => [
        ...currentNodes.map((node) => ({ ...node, selected: false })),
        nextNode,
      ]);
    },
    [setNodes],
  );

  const handleFlowDragOver = useCallback((event: ReactDragEvent) => {
    if (!event.dataTransfer.types.includes(MATERIAL_ASSET_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'copy';
  }, []);

  const handleFlowDrop = useCallback(
    (event: ReactDragEvent) => {
      const asset = readMaterialAssetDragPayload(event.dataTransfer);
      if (!asset) return;
      event.preventDefault();
      const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addMaterialAssetNode(asset, position);
    },
    [addMaterialAssetNode, reactFlow],
  );

  const isValidConnection = useCallback(
    (connection: Connection | LumenEdge) => {
      return canCreateConnection(connection, nodes, edges);
    },
    [edges, nodes],
  );

  const connectionSucceededRef = useRef(false);
  const connectingRef = useRef<{
    nodeId: string;
    handleType: 'source' | 'target';
    handleId: string | null;
    fromKind: NodeKind;
  } | null>(null);
  const [quickMenuState, setQuickMenuState] = useState<{
    visible: boolean;
    screen: { x: number; y: number };
    sourceNodeId: string;
    handleType: 'source' | 'target';
    handleId: string | null;
    fromKind: NodeKind;
  } | null>(null);

  const onConnect = useCallback(
    (connection: Connection) => {
      if (!connection.source || !connection.target || !isValidConnection(connection)) {
        return;
      }

      connectionSucceededRef.current = true;
      setEdges((currentEdges) =>
        addEdge(createEdge(connection.source, connection.target, connection), currentEdges),
      );
    },
    [isValidConnection, setEdges],
  );

  const onConnectStart: OnConnectStart = useCallback(
    (_event, params) => {
      connectionSucceededRef.current = false;
      const sourceNode = nodes.find((node) => node.id === params.nodeId);
      if (!sourceNode || !params.nodeId || !params.handleType) {
        connectingRef.current = null;
        return;
      }
      connectingRef.current = {
        nodeId: params.nodeId,
        handleType: params.handleType,
        handleId: params.handleId ?? null,
        fromKind: sourceNode.data.kind,
      };
    },
    [nodes],
  );

  const onConnectEnd: OnConnectEnd = useCallback((event) => {
    const connectingInfo = connectingRef.current;
    connectingRef.current = null;
    if (!connectingInfo) return;
    if (connectionSucceededRef.current) {
      connectionSucceededRef.current = false;
      return;
    }
    const targetEl = event.target as HTMLElement | null;
    const onPane = !!targetEl?.classList?.contains('react-flow__pane');
    if (!onPane) return;

    const clientX =
      'clientX' in event ? event.clientX : ((event as TouchEvent).touches?.[0]?.clientX ?? 0);
    const clientY =
      'clientY' in event ? event.clientY : ((event as TouchEvent).touches?.[0]?.clientY ?? 0);

    setQuickMenuState({
      visible: true,
      screen: { x: clientX, y: clientY },
      sourceNodeId: connectingInfo.nodeId,
      handleType: connectingInfo.handleType,
      handleId: connectingInfo.handleId,
      fromKind: connectingInfo.fromKind,
    });
  }, []);

  const closeQuickMenu = useCallback(() => setQuickMenuState(null), []);

  const handleQuickMenuPick = useCallback(
    (template: NodeTemplate) => {
      if (!quickMenuState) return;
      const flowPos = reactFlow.screenToFlowPosition(quickMenuState.screen);
      const isFromSource = quickMenuState.handleType === 'source';
      const sourceNode = reactFlow.getNode(quickMenuState.sourceNodeId);
      const sourceSize = sourceNode ? getNodeSize(sourceNode) : { width: 380, height: 400 };

      const newNodeId = `${template.kind}-${Date.now()}-${Math.round(Math.random() * 9999)}`;
      const position = isFromSource
        ? { x: flowPos.x, y: flowPos.y - sourceSize.height / 2 }
        : { x: flowPos.x - 380, y: flowPos.y - sourceSize.height / 2 };

      const baseData = createNodeData(template);
      const nextNode: LumenNode = {
        id: newNodeId,
        type: 'lumenNode',
        position,
        selected: true,
        zIndex: 20,
        data: {
          ...baseData,
          groupId: sourceNode?.data.groupId ?? null,
          groupName: sourceNode?.data.groupName ?? null,
        },
      };

      const source = isFromSource ? quickMenuState.sourceNodeId : newNodeId;
      const target = isFromSource ? newNodeId : quickMenuState.sourceNodeId;

      setNodes((currentNodes) => [
        ...currentNodes.map((node) => ({ ...node, selected: false })),
        nextNode,
      ]);
      setEdges((currentEdges) => addEdge(createEdge(source, target), currentEdges));
      setQuickMenuState(null);
    },
    [quickMenuState, reactFlow, setEdges, setNodes],
  );

  const onReconnect = useCallback(
    (oldEdge: LumenEdge, connection: Connection) => {
      if (!connection.source || !connection.target) return;

      setEdges((currentEdges) => {
        const edgesWithoutOld = currentEdges.filter((edge) => edge.id !== oldEdge.id);
        if (
          !canCreateConnection(connection, nodes, edgesWithoutOld) ||
          hasEquivalentEdge(edgesWithoutOld, connection)
        ) {
          return currentEdges;
        }

        return reconnectEdge(oldEdge, connection, currentEdges, { shouldReplaceId: false });
      });
    },
    [nodes, setEdges],
  );

  const selectAllElements = useCallback(() => {
    setNodes((currentNodes) => currentNodes.map((node) => ({ ...node, selected: true })));
    setEdges((currentEdges) => currentEdges.map((edge) => ({ ...edge, selected: true })));
  }, [setEdges, setNodes]);

  const deleteSelectedElements = useCallback(() => {
    const selectedNodeIds = new Set(
      reactFlow
        .getNodes()
        .filter((node) => node.selected)
        .map((node) => node.id),
    );
    const selectedEdgeIds = new Set(
      reactFlow
        .getEdges()
        .filter((edge) => edge.selected)
        .map((edge) => edge.id),
    );

    if (selectedNodeIds.size === 0 && selectedEdgeIds.size === 0) {
      return;
    }

    setNodes((currentNodes) => currentNodes.filter((node) => !selectedNodeIds.has(node.id)));
    setEdges((currentEdges) =>
      currentEdges.filter(
        (edge) =>
          !selectedEdgeIds.has(edge.id) &&
          !selectedNodeIds.has(edge.source) &&
          !selectedNodeIds.has(edge.target),
      ),
    );
  }, [reactFlow, setEdges, setNodes]);

  const arrangeCanvas = useCallback(() => {
    setNodes((currentNodes) => arrangeCanvasNodes(currentNodes, reactFlow.getEdges()));
    window.requestAnimationFrame(() => {
      reactFlow.fitView({ padding: 0.28, duration: 320, maxZoom: 1 });
    });
  }, [reactFlow, setNodes]);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }

      const key = event.key.toLowerCase();
      if ((event.metaKey || event.ctrlKey) && key === 'a') {
        event.preventDefault();
        selectAllElements();
        return;
      }

      if (event.key === 'Backspace' || event.key === 'Delete') {
        const hasSelection =
          reactFlow.getNodes().some((node) => node.selected) ||
          reactFlow.getEdges().some((edge) => edge.selected);

        if (hasSelection) {
          event.preventDefault();
          deleteSelectedElements();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [deleteSelectedElements, reactFlow, selectAllElements]);

  const onPaneClick = useCallback(
    (event: MouseEvent) => {
      if (event.detail < 2) {
        return;
      }

      const position = reactFlow.screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addCanvasNode(getTemplate(activeKind), position);
    },
    [activeKind, addCanvasNode, reactFlow],
  );

  const collapseSingleNodeSelectionFrame = useCallback(() => {
    queueMicrotask(() => {
      const selectedNodeCount = reactFlowStore
        .getState()
        .nodes.filter((node) => node.selected).length;

      if (selectedNodeCount <= 1) {
        reactFlowStore.setState({ nodesSelectionActive: false });
      }
    });
  }, [reactFlowStore]);

  const onPickTemplate = useCallback(
    (template: NodeTemplate) => {
      setActiveKind(template.kind);
      addCanvasNode(template);
      setNodeMenuOpen(false);
    },
    [addCanvasNode],
  );

  const toggleNodeMenu = useCallback(() => {
    setNodeMenuOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        setMaterialPanelOpen(false);
        setHistoryPanelOpen(false);
      }
      return nextOpen;
    });
  }, []);

  const toggleMaterialPanel = useCallback(() => {
    setMaterialPanelOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        setNodeMenuOpen(false);
        setHistoryPanelOpen(false);
      }
      return nextOpen;
    });
  }, []);

  const toggleHistoryPanel = useCallback(() => {
    setHistoryPanelOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        setNodeMenuOpen(false);
        setMaterialPanelOpen(false);
      }
      return nextOpen;
    });
  }, []);

  const restoreHistoryRecord = useCallback(
    async (record: ProjectHistoryRecord) => {
      if (!currentProjectId) {
        throw new Error(t('canvas.history.missingProject'));
      }

      let snapshot = record;
      if (!snapshot.canvas) {
        const response = await fetch(
          `/api/projects/${currentProjectId}/history/${encodeURIComponent(record.id)}`,
          { headers: { 'x-lumen-locale': locale } },
        );
        const payload = (await response.json()) as ProjectHistoryRecordApiResponse;

        if (!response.ok || !payload.ok) {
          throw new Error(payload.ok ? t('canvas.history.readFailed') : payload.error.message);
        }

        snapshot = payload.data.history;
      }

      if (!snapshot.canvas) {
        throw new Error(t('canvas.history.missingSnapshot'));
      }

      setProjectTitle(snapshot.title);
      setNodes(withCanvasNodeLayering(snapshot.canvas.nodes));
      setEdges(withCanvasEdgeLayering(snapshot.canvas.edges));
      setHistoryPanelOpen(false);
    },
    [currentProjectId, locale, setEdges, setNodes, t],
  );

  const canvasActions = useMemo<CanvasActions>(
    () => ({
      runSingleNode,
      cancelNodes,
      updateNodeData,
      uploadCanvasMedia,
      connectionError,
      canRunNode,
    }),
    [runSingleNode, cancelNodes, updateNodeData, uploadCanvasMedia, connectionError, canRunNode],
  );

  return (
    <main
      className={cn(
        'relative overflow-hidden bg-[#050607] text-white',
        isMobileCanvas ? 'h-dvh' : 'h-screen',
      )}
    >
      <CanvasGrid />
      <CanvasActionsContext.Provider value={canvasActions}>
        <div className="absolute inset-0 z-10">
          {isMobileCanvas ? <MobileCanvasFitView enabled /> : null}
          <ReactFlow
            className="lumen-flow"
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onReconnect={onReconnect}
            onDragOver={handleFlowDragOver}
            onDrop={handleFlowDrop}
            onSelectionEnd={collapseSingleNodeSelectionFrame}
            isValidConnection={isValidConnection}
            edgesFocusable
            edgesReconnectable
            reconnectRadius={14}
            onPaneClick={onPaneClick}
            connectionLineComponent={LumenConnectionLine}
            connectionRadius={isMobileCanvas ? 58 : 42}
            deleteKeyCode={['Backspace', 'Delete']}
            disableKeyboardA11y={false}
            elementsSelectable
            elevateEdgesOnSelect={false}
            elevateNodesOnSelect
            multiSelectionKeyCode={['Meta', 'Control']}
            panActivationKeyCode="Space"
            panOnDrag={[1, 2]}
            selectionKeyCode="Shift"
            selectionMode={SelectionMode.Partial}
            selectionOnDrag
            selectNodesOnDrag
            zoomActivationKeyCode={['Meta', 'Control']}
            defaultEdgeOptions={{
              type: 'lumenSmooth',
              reconnectable: true,
              zIndex: 0,
              data: {},
            }}
            fitView
            fitViewOptions={{ padding: 0.36, maxZoom: 1 }}
            minZoom={0.35}
            maxZoom={1.75}
            nodeOrigin={[0, 0]}
            onlyRenderVisibleElements
            panOnScroll={!isMobileCanvas}
            snapToGrid
            snapGrid={[24, 24]}
            proOptions={{ hideAttribution: true }}
          >
            <Background
              color="rgba(255,255,255,0.14)"
              gap={24}
              size={1}
              variant={BackgroundVariant.Dots}
            />
            <ViewportPortal>
              {nodeGroups.map((group) =>
                group.bounds ? (
                  <GroupFrame
                    key={group.id}
                    bounds={group.bounds}
                    canRun={group.canRun}
                    name={group.name}
                    onStop={() => cancelGroup(group.id)}
                    onRun={() => runGroup(group.id)}
                    onUngroup={() => ungroupNodes(group.id)}
                    running={group.running}
                    selected={group.selected}
                  />
                ) : null,
              )}
              {ungroupedSelectionBounds ? (
                <SelectionGroupToolbar
                  bounds={ungroupedSelectionBounds}
                  onGroup={groupSelectedNodes}
                  selectedCount={selectedNodes.length}
                />
              ) : null}
            </ViewportPortal>
          </ReactFlow>
        </div>

        <CanvasTopbar
          compact={isMobileCanvas}
          projectId={currentProjectId}
          saveState={saveState}
          title={projectTitle}
        />
        {isMobileCanvas ? (
          <MobileCanvasBottomToolbar
            historyPanelOpen={historyPanelOpen}
            materialPanelOpen={materialPanelOpen}
            menuOpen={nodeMenuOpen}
            onToggleHistoryPanel={toggleHistoryPanel}
            onToggleMaterialPanel={toggleMaterialPanel}
            onToggleMenu={toggleNodeMenu}
            nodeMenu={nodeMenuOpen ? <NodeAddMenu onPickTemplate={onPickTemplate} /> : null}
          />
        ) : (
          <LeftToolbar
            historyPanelOpen={historyPanelOpen}
            materialPanelOpen={materialPanelOpen}
            menuOpen={nodeMenuOpen}
            onPickTemplate={onPickTemplate}
            onToggleHistoryPanel={toggleHistoryPanel}
            onToggleMaterialPanel={toggleMaterialPanel}
            onToggleMenu={toggleNodeMenu}
          />
        )}
        {materialPanelOpen && isMobileCanvas ? (
          <MobileSheet
            open
            onClose={() => setMaterialPanelOpen(false)}
            size="full"
            title={t('canvas.toolbar.materials')}
          >
            <MaterialLibraryPanel
              embedded
              projectId={currentProjectId}
              onClose={() => setMaterialPanelOpen(false)}
            />
          </MobileSheet>
        ) : materialPanelOpen ? (
          <MaterialLibraryPanel
            projectId={currentProjectId}
            onClose={() => setMaterialPanelOpen(false)}
          />
        ) : null}
        {historyPanelOpen && isMobileCanvas ? (
          <MobileSheet
            open
            onClose={() => setHistoryPanelOpen(false)}
            size="full"
            title={t('canvas.history.title')}
          >
            <ProjectHistoryPanel
              embedded
              projectId={currentProjectId}
              onClose={() => setHistoryPanelOpen(false)}
              onRestore={restoreHistoryRecord}
            />
          </MobileSheet>
        ) : historyPanelOpen ? (
          <ProjectHistoryPanel
            projectId={currentProjectId}
            onClose={() => setHistoryPanelOpen(false)}
            onRestore={restoreHistoryRecord}
          />
        ) : null}
        {isMobileCanvas ? (
          <MobileCanvasBottomControls
            canArrange={nodes.length > 1}
            onArrange={arrangeCanvas}
            onDeleteSelected={deleteSelectedElements}
            onSelectAll={selectAllElements}
            selectedElementCount={selectedElementCount}
          />
        ) : (
          <BottomControls
            canArrange={nodes.length > 1}
            onArrange={arrangeCanvas}
            onDeleteSelected={deleteSelectedElements}
            onSelectAll={selectAllElements}
            selectedElementCount={selectedElementCount}
          />
        )}
        <ChatPanel
          projectId={currentProjectId ?? undefined}
          initialPrompt={initialPrompt}
          defaultOpen={shouldOpenAgentChat}
          onWorkflowUpdate={handleAgentWorkflowUpdate}
          onWorkflowNodeStatus={handleAgentWorkflowNodeStatus}
        />
        {quickMenuState?.visible ? (
          <QuickNodeMenu
            screen={quickMenuState.screen}
            handleType={quickMenuState.handleType}
            fromKind={quickMenuState.fromKind}
            onPick={handleQuickMenuPick}
            onClose={closeQuickMenu}
          />
        ) : null}
      </CanvasActionsContext.Provider>
      <AnimatePresence>
        {isCanvasHydrated ? null : (
          <CanvasHydrationOverlay
            key="canvas-hydration"
            label={t('canvas.hydration.preparing')}
            hint={t('canvas.hydration.hint')}
          />
        )}
      </AnimatePresence>
    </main>
  );
}

function serializeCanvas(nodes: LumenNode[], edges: LumenEdge[]) {
  return {
    nodes: nodes.map((node) => {
      const settings = stripTransientCanvasValue(node.data.settings) as Record<string, unknown>;
      return {
        ...node,
        data: {
          ...node.data,
          settings,
          output: isBlobUrl(node.data.output) ? null : node.data.output,
        },
        dragging: undefined,
        selected: undefined,
        zIndex: undefined,
      };
    }),
    edges: edges.map((edge) => ({
      ...edge,
      selected: undefined,
      zIndex: undefined,
    })),
  };
}

function readEventString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function readEventNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function readNodeStatus(value: unknown): NodeState['status'] | null {
  if (
    value === 'idle' ||
    value === 'queued' ||
    value === 'running' ||
    value === 'success' ||
    value === 'error' ||
    value === 'cancelled'
  ) {
    return value;
  }
  return null;
}

async function readProjectResponse(
  response: Response,
  fallbackMessage: string,
): Promise<CanvasProjectPayload> {
  const payload = (await response.json()) as ProjectApiResponse;

  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? fallbackMessage : payload.error.message);
  }

  return payload.data.project;
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT'
  );
}

function CanvasGrid() {
  return (
    <>
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_36%,rgba(69,119,176,0.13),transparent_34%),radial-gradient(circle_at_78%_18%,rgba(121,228,255,0.08),transparent_24%),linear-gradient(180deg,rgba(7,10,12,0.2),rgba(5,6,7,0.92)_78%)]" />
      <div className="absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-[#050607] via-[#050607]/86 to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-28 bg-gradient-to-t from-[#050607] via-[#050607]/78 to-transparent" />
    </>
  );
}

type FlowBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function GroupFrame({
  bounds,
  canRun,
  name,
  onRun,
  onStop,
  onUngroup,
  running,
  selected,
}: {
  bounds: FlowBounds;
  canRun: boolean;
  name: string;
  onRun: () => void;
  onStop: () => void;
  onUngroup: () => void;
  running: boolean;
  selected: boolean;
}) {
  const { t } = useI18n();
  return [
    <div
      key="frame"
      className="absolute pointer-events-none"
      style={{
        height: bounds.height,
        transform: `translate(${bounds.x}px, ${bounds.y}px)`,
        width: bounds.width,
        zIndex: 1,
      }}
    >
      <div
        className={`absolute inset-0 rounded-[16px] border bg-white/[0.035] shadow-[inset_0_1px_0_rgba(255,255,255,0.08)] ${
          running
            ? 'lumen-group-frame--running border-[#79e4ff]/42'
            : selected
              ? 'border-white/42'
              : 'border-white/[0.16]'
        }`}
      />
      <div className="absolute left-3 top-[-20px] flex items-center gap-1.5 text-[11px] font-bold text-white/44">
        <IconLayoutGrid size={13} stroke={2.2} />
        {name}
      </div>
    </div>,
    selected ? (
      <div
        key="toolbar"
        className="nodrag nopan pointer-events-auto absolute flex items-center gap-1.5 rounded-[18px] bg-[#232427]/95 p-1.5 text-white shadow-[0_20px_56px_rgba(0,0,0,0.42)] ring-1 ring-white/[0.12] backdrop-blur-xl"
        onPointerDown={(event) => event.stopPropagation()}
        style={{
          transform: `translate(${bounds.x + bounds.width / 2}px, ${bounds.y - 62}px) translateX(-50%)`,
          zIndex: 80,
        }}
      >
        <span className="flex h-8 items-center gap-1.5 rounded-[13px] bg-white/[0.08] px-2.5 text-[12px] font-black text-white/88">
          <IconLayoutGrid size={14} stroke={2.2} />
          {name}
        </span>
        <button
          type="button"
          aria-label={running ? t('canvas.node.stop') : t('canvas.groupActions.runGroup')}
          aria-busy={running}
          disabled={!running && !canRun}
          onClick={running ? onStop : onRun}
          className={`flex h-8 items-center gap-1.5 rounded-[13px] px-2.5 text-[12px] font-black transition-colors disabled:cursor-not-allowed ${
            running
              ? 'bg-white text-[#111315] shadow-[0_0_22px_rgba(121,228,255,0.2)]'
              : 'text-white/72 hover:bg-white/[0.08] hover:text-white disabled:opacity-30'
          }`}
        >
          {running ? (
            <IconPlayerStop size={14} stroke={2.4} />
          ) : (
            <IconPlayerPlay size={14} stroke={2.4} />
          )}
          {running ? t('canvas.node.stop') : t('canvas.groupActions.runGroup')}
        </button>
        <button
          type="button"
          aria-label={t('canvas.groupActions.ungroup')}
          onClick={onUngroup}
          className="flex h-8 items-center gap-1.5 rounded-[13px] px-2.5 text-[12px] font-black text-white/72 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <IconGridDots size={14} stroke={2.4} />
          {t('canvas.groupActions.ungroup')}
        </button>
      </div>
    ) : null,
  ];
}

function SelectionGroupToolbar({
  bounds,
  onGroup,
  selectedCount,
}: {
  bounds: FlowBounds;
  onGroup: () => void;
  selectedCount: number;
}) {
  const { t } = useI18n();
  return (
    <div
      className="nodrag nopan pointer-events-auto absolute flex items-center gap-1.5 rounded-[18px] bg-[#232427]/95 p-1.5 text-white shadow-[0_20px_56px_rgba(0,0,0,0.42)] ring-1 ring-white/[0.12] backdrop-blur-xl"
      onPointerDown={(event) => event.stopPropagation()}
      style={{
        transform: `translate(${bounds.x + bounds.width / 2}px, ${bounds.y - 62}px) translateX(-50%)`,
        zIndex: 80,
      }}
    >
      <span className="flex h-8 items-center gap-1.5 rounded-[13px] bg-white/[0.08] px-2.5 text-[12px] font-black text-white/82">
        <IconSelectAll size={14} stroke={2.2} />
        {t('canvas.groupActions.selected', { count: selectedCount })}
      </span>
      <button
        type="button"
        aria-label={t('canvas.groupActions.group')}
        onClick={onGroup}
        className="flex h-8 items-center gap-1.5 rounded-[13px] px-2.5 text-[12px] font-black text-white/72 transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <IconLayoutGrid size={14} stroke={2.4} />
        {t('canvas.groupActions.group')}
      </button>
    </div>
  );
}

function CanvasTopbar({
  compact = false,
  projectId,
  saveState,
  title,
}: {
  compact?: boolean;
  projectId: string | null;
  saveState: CanvasSaveState;
  title: string;
}) {
  const { locale, t, localePath } = useI18n();
  const saveLabel = getSaveLabel(saveState, t);
  const [shareState, setShareState] = useState<'idle' | 'copying' | 'copied' | 'error'>('idle');

  const shareProject = useCallback(async () => {
    if (!projectId || shareState === 'copying') return;

    setShareState('copying');
    try {
      const response = await fetch(`/api/projects/${projectId}/share`, {
        method: 'POST',
        headers: { 'x-lumen-locale': locale },
      });
      const payload = (await response.json()) as ShareProjectApiResponse;

      if (!response.ok || !payload.ok) {
        throw new Error(payload.ok ? t('canvas.shareLinkFailed') : payload.error.message);
      }

      await navigator.clipboard.writeText(payload.data.shareUrl);
      setShareState('copied');
      window.setTimeout(() => setShareState('idle'), 1600);
    } catch (error) {
      console.error(error);
      setShareState('error');
      window.setTimeout(() => setShareState('idle'), 2200);
    }
  }, [locale, projectId, shareState, t]);

  return (
    <header
      className={cn(
        'pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center justify-between px-4 pt-[max(0px,env(safe-area-inset-top))] sm:px-5',
        compact ? 'h-14' : 'h-20',
      )}
    >
      <div className="pointer-events-auto flex min-w-0 items-center gap-2 sm:gap-3">
        <Link
          href={localePath('/canvas/projects')}
          aria-label={t('canvas.back')}
          className="flex min-h-11 min-w-11 items-center justify-center rounded-2xl bg-white/[0.07] text-white/70 ring-1 ring-white/[0.09] transition-colors hover:bg-white/[0.12] hover:text-white"
        >
          <IconArrowLeft size={18} stroke={2.2} />
        </Link>
        {!compact ? <LumenMark size={32} /> : null}
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="truncate font-display text-[15px] font-bold leading-none text-white sm:text-[16px]">
              {title}
            </h1>
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold ring-1 sm:text-[11px] ${
                saveState === 'error'
                  ? 'bg-[#ff5d73]/15 text-[#ff9daa] ring-[#ff5d73]/18'
                  : 'bg-white/[0.07] text-white/52 ring-white/[0.08]'
              }`}
            >
              {saveLabel}
            </span>
          </div>
          {!compact ? (
            <p className="mt-1 hidden text-[12px] text-white/42 sm:block">
              {t('canvas.studioPath')}
            </p>
          ) : null}
        </div>
      </div>

      <div className="pointer-events-auto flex shrink-0 items-center gap-2">
        <NotificationsPopover triggerClassName="min-h-11 min-w-11 rounded-2xl bg-white/[0.07] text-white/66 ring-white/[0.08] hover:bg-white/[0.12]" />
        <button
          type="button"
          aria-label={
            shareState === 'copied' ? t('canvas.shareLinkCopied') : t('canvas.shareProject')
          }
          disabled={!projectId || shareState === 'copying'}
          onClick={shareProject}
          className={cn(
            'flex min-h-11 items-center justify-center rounded-2xl bg-white font-bold text-[#111315] shadow-[0_16px_40px_rgba(0,0,0,0.28)] transition-transform hover:scale-[1.02]',
            compact ? 'min-w-11 px-0' : 'gap-2 px-4 text-[13px]',
          )}
        >
          {shareState === 'copying' ? (
            <IconLoader2 size={16} className="animate-spin" stroke={2.3} />
          ) : shareState === 'copied' ? (
            <IconCheck size={16} stroke={2.8} />
          ) : (
            <IconShare3 size={16} stroke={2.3} />
          )}
          {!compact
            ? shareState === 'copied'
              ? t('canvas.shareCopied')
              : shareState === 'error'
                ? t('canvas.shareFailed')
                : t('canvas.shareProject')
            : null}
        </button>
      </div>
    </header>
  );
}

function getSaveLabel(
  saveState: CanvasSaveState,
  t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string,
) {
  switch (saveState) {
    case 'loading':
      return t('canvas.save.loading');
    case 'saving':
      return t('canvas.save.saving');
    case 'error':
      return t('canvas.save.error');
    case 'idle':
    case 'saved':
      return t('canvas.save.autosave');
  }
}

function LeftToolbar({
  historyPanelOpen,
  materialPanelOpen,
  menuOpen,
  onPickTemplate,
  onToggleHistoryPanel,
  onToggleMaterialPanel,
  onToggleMenu,
}: {
  historyPanelOpen: boolean;
  materialPanelOpen: boolean;
  menuOpen: boolean;
  onPickTemplate: (template: NodeTemplate) => void;
  onToggleHistoryPanel: () => void;
  onToggleMaterialPanel: () => void;
  onToggleMenu: () => void;
}) {
  const { t } = useI18n();
  return (
    <aside className="absolute left-5 top-24 z-40 flex items-start">
      <div className="flex h-[430px] w-[64px] flex-col items-center rounded-[28px] bg-[#151719]/90 p-2 shadow-[0_22px_70px_rgba(0,0,0,0.42)] ring-1 ring-white/[0.08] backdrop-blur-xl">
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-label={t('canvas.toolbar.addNode')}
          title={t('canvas.toolbar.addNode')}
          onClick={onToggleMenu}
          className={`flex h-11 w-11 items-center justify-center rounded-full shadow-[0_10px_28px_rgba(255,255,255,0.14)] transition-transform hover:scale-105 ${
            menuOpen ? 'bg-[#79e4ff] text-[#061016]' : 'bg-white text-[#111315]'
          }`}
        >
          <IconPlus size={22} stroke={2.2} />
        </button>

        <div className="mt-4 flex flex-col items-center gap-2">
          <ToolbarButton
            active={materialPanelOpen}
            ariaLabel={t('canvas.toolbar.materials')}
            icon={IconFolder}
            label={t('canvas.toolbar.materials')}
            onClick={onToggleMaterialPanel}
          />
          <ToolbarButton
            active={historyPanelOpen}
            ariaLabel={t('canvas.toolbar.history')}
            icon={IconClock}
            label={t('canvas.toolbar.history')}
            onClick={onToggleHistoryPanel}
          />
        </div>

        <div className="mt-auto h-px w-8 bg-white/[0.1]" />
        <div className="mt-4 mb-1 flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-[#24272b] ring-2 ring-white/[0.12]">
          <LumenMark size={28} />
        </div>
      </div>
      {menuOpen ? <NodeAddMenu onPickTemplate={onPickTemplate} /> : null}
    </aside>
  );
}

function ToolbarButton({
  active = false,
  ariaLabel,
  icon: Icon,
  label,
  onClick,
}: {
  active?: boolean;
  ariaLabel: string;
  icon: typeof IconPlus;
  label: string;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      title={label}
      onClick={onClick}
      className={`group relative flex h-11 w-11 items-center justify-center rounded-2xl transition-colors ${
        active
          ? 'bg-white/[0.12] text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.08)]'
          : 'text-white/64 hover:bg-white/[0.08] hover:text-white'
      }`}
    >
      <Icon size={21} stroke={2.1} />
      <span className="pointer-events-none absolute left-[calc(100%+14px)] top-1/2 hidden -translate-y-1/2 whitespace-nowrap rounded-2xl bg-[#303235]/96 px-3.5 py-2 text-[13px] font-bold text-white shadow-[0_14px_34px_rgba(0,0,0,0.36)] ring-1 ring-white/[0.08] group-hover:block">
        {label}
      </span>
    </button>
  );
}

const PANEL_DOCK_CLASS =
  'absolute left-24 top-[92px] bottom-24 z-30 flex w-[calc(100vw-116px)] max-w-[340px] flex-col overflow-hidden rounded-[24px] bg-[#111315]/94 text-white shadow-[0_28px_90px_rgba(0,0,0,0.5)] ring-1 ring-white/[0.09] backdrop-blur-2xl sm:w-[340px]';
const PANEL_EMBEDDED_CLASS =
  'relative flex w-full flex-col overflow-hidden rounded-[18px] bg-[#111315]/94 text-white ring-1 ring-white/[0.09]';

function MaterialLibraryPanel({
  embedded = false,
  onClose,
  projectId,
}: {
  embedded?: boolean;
  onClose: () => void;
  projectId: string | null;
}) {
  const { locale, t } = useI18n();
  const [activeCategory, setActiveCategory] = useState<MaterialAssetCategory | null>(null);
  const [activeKind, setActiveKind] = useState<MaterialAssetKind>('image');
  const [myAssetsExpanded, setMyAssetsExpanded] = useState(false);
  const [assets, setAssets] = useState<MaterialAssetRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const workflowId = projectId;
    const category = activeCategory;
    if (!workflowId || !category) {
      setAssets([]);
      setLoading(false);
      return;
    }
    const workflowIdParam: string = workflowId;
    const categoryParam: MaterialAssetCategory = category;

    const controller = new AbortController();
    setLoading(true);

    async function loadAssets() {
      try {
        const params = new URLSearchParams({
          workflowId: workflowIdParam,
          category: categoryParam,
          limit: '80',
        });
        if (categoryParam === 'my_assets') params.set('kind', activeKind);
        const response = await fetch(`/api/material-assets?${params.toString()}`, {
          signal: controller.signal,
          headers: { 'x-lumen-locale': locale },
        });
        const payload = (await response.json()) as MaterialAssetsApiResponse;

        if (!response.ok || !payload.ok) {
          throw new Error(payload.ok ? t('canvas.materials.readFailed') : payload.error.message);
        }

        setAssets(payload.data.assets);
        setError(null);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(
            loadError instanceof Error ? loadError.message : t('canvas.materials.readFailed'),
          );
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadAssets();
    return () => controller.abort();
  }, [activeCategory, activeKind, locale, projectId, t]);

  const visibleAssets = useMemo(() => {
    if (!activeCategory) return [];
    if (activeCategory === 'my_assets') {
      return assets.filter((asset) => asset.category === 'my_assets' && asset.kind === activeKind);
    }
    return assets.filter((asset) => asset.category === activeCategory);
  }, [activeCategory, activeKind, assets]);

  const categoryCounts = useMemo(() => {
    return materialCategories.reduce(
      (counts, category) => {
        counts[category.id] = assets.filter((asset) => asset.category === category.id).length;
        return counts;
      },
      {} as Record<MaterialAssetCategory, number>,
    );
  }, [assets]);

  const kindCounts = useMemo(() => {
    return materialKinds.reduce(
      (counts, kind) => {
        counts[kind.id] = assets.filter(
          (asset) => asset.category === 'my_assets' && asset.kind === kind.id,
        ).length;
        return counts;
      },
      {} as Record<MaterialAssetKind, number>,
    );
  }, [assets]);

  return (
    <section className={cn(embedded ? PANEL_EMBEDDED_CLASS : PANEL_DOCK_CLASS)}>
      <div className="flex items-center gap-2 px-4 pt-4">
        <button
          type="button"
          aria-label={t('canvas.materials.collapse')}
          onClick={onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white/52 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <IconChevronLeft size={19} stroke={2.2} />
        </button>
        <h2 className="min-w-0 flex-1 truncate font-display text-[24px] font-black tracking-tight text-white">
          {t('canvas.materials.title')}
        </h2>
      </div>

      <div className="mt-3 flex-1 overflow-y-auto px-4 pb-4">
        <div className="mb-2 px-2 text-[12px] font-bold text-white/36">
          {t('canvas.materials.categories')}
        </div>
        <div className="space-y-1">
          {materialCategories.map((category) => {
            const active = category.id === activeCategory;

            return (
              <div key={category.id}>
                <button
                  type="button"
                  onClick={() => {
                    if (category.id === 'my_assets') {
                      const nextExpanded = !(activeCategory === 'my_assets' && myAssetsExpanded);
                      setMyAssetsExpanded(nextExpanded);
                      setActiveCategory(nextExpanded ? 'my_assets' : null);
                      return;
                    }

                    setActiveCategory(category.id);
                    setMyAssetsExpanded(false);
                  }}
                  className={`group flex h-12 w-full items-center gap-2 rounded-2xl px-2 text-left transition-colors ${
                    active ? 'bg-white/[0.1]' : 'hover:bg-white/[0.06]'
                  }`}
                >
                  <IconChevronDown
                    size={16}
                    className={`shrink-0 text-white/42 transition-transform ${
                      category.id === 'my_assets' && myAssetsExpanded ? 'rotate-0' : '-rotate-90'
                    }`}
                    stroke={2.2}
                  />
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] text-white/68 ring-1 ring-white/[0.06]">
                    {active ? (
                      <IconFolderFilled size={21} className="text-white/76" />
                    ) : (
                      <IconFolder size={21} stroke={2.05} />
                    )}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[14px] font-bold text-white/72 group-hover:text-white">
                    {t(`canvas.materials.${category.id}`)}
                  </span>
                  <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold text-white/36">
                    {categoryCounts[category.id] ?? 0}
                  </span>
                </button>
                {category.id === 'my_assets' && myAssetsExpanded ? (
                  <div className="mt-1 space-y-1 pl-10">
                    {materialKinds.map((kind) => (
                      <MaterialKindButton
                        active={activeCategory === 'my_assets' && activeKind === kind.id}
                        count={kindCounts[kind.id] ?? 0}
                        kind={kind}
                        key={kind.id}
                        onClick={() => {
                          setActiveCategory('my_assets');
                          setActiveKind(kind.id);
                        }}
                      />
                    ))}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="mt-5 px-2 text-[12px] font-bold text-white/36">
          {!activeCategory
            ? t('canvas.materials.selectCategory')
            : activeCategory === 'my_assets'
              ? t(`canvas.materials.${activeKind}`)
              : t(`canvas.materials.${activeCategory}`)}
        </div>

        <div className="mt-2 space-y-2">
          {!activeCategory ? (
            <PanelEmptyState
              label={loading ? t('canvas.materials.loading') : t('canvas.materials.selectCategory')}
            />
          ) : loading ? (
            <PanelEmptyState label={t('canvas.materials.loading')} />
          ) : error ? (
            <PanelEmptyState label={error} tone="error" />
          ) : visibleAssets.length === 0 ? (
            <PanelEmptyState
              label={
                activeCategory === 'my_assets'
                  ? t('canvas.materials.emptyGenerated')
                  : t('canvas.materials.emptyCategory')
              }
            />
          ) : (
            visibleAssets.map((asset) => <MaterialAssetCard asset={asset} key={asset.id} />)
          )}
        </div>
      </div>
    </section>
  );
}

function ProjectHistoryPanel({
  embedded = false,
  onClose,
  onRestore,
  projectId,
}: {
  embedded?: boolean;
  onClose: () => void;
  onRestore: (record: ProjectHistoryRecord) => Promise<void> | void;
  projectId: string | null;
}) {
  const { locale, t } = useI18n();
  const [history, setHistory] = useState<ProjectHistoryRecord[]>([]);
  const [loading, setLoading] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId) {
      setHistory([]);
      return;
    }

    const controller = new AbortController();
    setLoading(true);

    async function loadHistory() {
      try {
        const response = await fetch(`/api/projects/${projectId}/history`, {
          signal: controller.signal,
          headers: { 'x-lumen-locale': locale },
        });
        const payload = (await response.json()) as ProjectHistoryApiResponse;

        if (!response.ok || !payload.ok) {
          throw new Error(payload.ok ? t('canvas.history.readFailed') : payload.error.message);
        }

        setHistory(payload.data.history);
        setError(null);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : t('canvas.history.readFailed'));
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadHistory();
    return () => controller.abort();
  }, [locale, projectId, t]);

  const handleRestore = async (record: ProjectHistoryRecord) => {
    setRestoringId(record.id);
    setError(null);
    try {
      await onRestore(record);
    } catch (restoreError) {
      setError(
        restoreError instanceof Error ? restoreError.message : t('canvas.history.restoreFailed'),
      );
    } finally {
      setRestoringId(null);
    }
  };

  return (
    <section className={cn(embedded ? PANEL_EMBEDDED_CLASS : PANEL_DOCK_CLASS)}>
      <div className="flex items-center gap-2 px-4 pt-4">
        <button
          type="button"
          aria-label={t('canvas.history.collapse')}
          onClick={onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white/52 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <IconChevronLeft size={19} stroke={2.2} />
        </button>
        <h2 className="min-w-0 flex-1 truncate font-display text-[24px] font-black tracking-tight text-white">
          {t('canvas.history.title')}
        </h2>
      </div>

      <div className="mt-3 flex-1 overflow-y-auto px-4 pb-4">
        <div className="mb-2 px-2 text-[12px] font-bold text-white/36">
          {t('canvas.history.recent')}
        </div>
        <div className="space-y-2">
          {loading ? (
            <PanelEmptyState label={t('canvas.history.loading')} />
          ) : error ? (
            <PanelEmptyState label={error} tone="error" />
          ) : history.length === 0 ? (
            <PanelEmptyState label={t('canvas.history.empty')} />
          ) : (
            history.map((record) => (
              <button
                key={record.id}
                type="button"
                disabled={restoringId !== null}
                onClick={() => void handleRestore(record)}
                className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.045] p-3 text-left ring-1 ring-white/[0.055] transition-colors hover:bg-white/[0.08]"
              >
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-white/[0.08] text-white/70 ring-1 ring-white/[0.06]">
                  <IconClock size={19} stroke={2.1} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-bold text-white/84">
                    {historyActionLabel(record.action, t)}
                  </span>
                  <span className="mt-1 block truncate text-[11px] font-medium text-white/38">
                    {t('canvas.history.meta', {
                      date: formatMaterialDate(record.createdAt, locale, t),
                      nodes: record.nodeCount,
                      edges: record.edgeCount,
                    })}
                  </span>
                </span>
                <span className="rounded-full bg-white/[0.07] px-2 py-0.5 text-[10px] font-bold text-white/42">
                  {restoringId === record.id
                    ? t('canvas.history.reading')
                    : t('canvas.history.restore')}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </section>
  );
}

function MaterialAssetCard({ asset }: { asset: MaterialAssetRecord }) {
  const { locale, t } = useI18n();
  return (
    <button
      type="button"
      draggable
      onDragStart={(event) => {
        event.dataTransfer.effectAllowed = 'copy';
        event.dataTransfer.setData(
          MATERIAL_ASSET_DRAG_TYPE,
          JSON.stringify(toMaterialAssetDragPayload(asset)),
        );
        event.dataTransfer.setData('text/uri-list', asset.url);
        event.dataTransfer.setData('text/plain', asset.title);
      }}
      onClick={() => window.open(asset.url, '_blank', 'noopener,noreferrer')}
      className="flex w-full cursor-grab items-center gap-3 rounded-2xl bg-white/[0.045] p-2 text-left ring-1 ring-white/[0.055] transition-colors hover:bg-white/[0.08] active:cursor-grabbing"
    >
      <span className="h-12 w-12 shrink-0 overflow-hidden rounded-xl bg-[#202328] ring-1 ring-white/[0.06]">
        {asset.kind === 'image' && (asset.thumbnailUrl || asset.url) ? (
          <img
            alt=""
            className="h-full w-full object-cover"
            decoding="async"
            loading="lazy"
            src={asset.thumbnailUrl ?? asset.url}
          />
        ) : (
          <span className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_32%_24%,rgba(121,228,255,0.32),transparent_24%),linear-gradient(145deg,#25282d,#111315)] text-white/54">
            {asset.kind === 'video' ? (
              <IconVideo size={20} stroke={2.1} />
            ) : asset.kind === 'audio' ? (
              <IconMusic size={20} stroke={2.1} />
            ) : (
              <IconPhoto size={20} stroke={2.1} />
            )}
          </span>
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13px] font-bold text-white/84">{asset.title}</span>
        <span className="mt-1 block truncate text-[11px] font-medium text-white/38">
          {materialKindLabel(asset.kind, t)} · {formatMaterialDate(asset.updatedAt, locale, t)}
        </span>
        {asset.metadata?.sellingPoints?.[0] ? (
          <span className="mt-1 block truncate text-[10.5px] text-white/28">
            {asset.metadata.sellingPoints[0]}
          </span>
        ) : null}
      </span>
      <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-bold uppercase text-white/32">
        {asset.kind}
      </span>
    </button>
  );
}

function PanelEmptyState({ label, tone = 'muted' }: { label: string; tone?: 'muted' | 'error' }) {
  return (
    <div
      className={`rounded-2xl px-3 py-5 text-center text-[12px] font-bold ring-1 ${
        tone === 'error'
          ? 'bg-[#2a171a]/60 text-[#ffabb6] ring-[#ff5d73]/16'
          : 'bg-white/[0.035] text-white/34 ring-white/[0.055]'
      }`}
    >
      {label}
    </div>
  );
}

const materialCategories = [
  { id: 'my_assets', label: '画布结果' },
  { id: 'item', label: '商品图集' },
  { id: 'character', label: 'AI模特' },
  { id: 'scene', label: '真人模特' },
] satisfies Array<{ id: MaterialAssetCategory; label: string }>;

const materialKinds = [
  { id: 'image', label: '图片', icon: IconPhoto },
  { id: 'video', label: '视频', icon: IconVideo },
  { id: 'audio', label: '音乐', icon: IconMusic },
] satisfies Array<{ id: MaterialAssetKind; label: string; icon: typeof IconPlus }>;

function MaterialKindButton({
  active,
  count,
  kind,
  onClick,
}: {
  active: boolean;
  count: number;
  kind: (typeof materialKinds)[number];
  onClick: () => void;
}) {
  const { t } = useI18n();
  const Icon = kind.icon;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex h-9 w-full items-center gap-2 rounded-xl px-2 text-left text-[12px] font-bold transition-colors ${
        active
          ? 'bg-white/[0.1] text-white'
          : 'text-white/52 hover:bg-white/[0.06] hover:text-white/78'
      }`}
    >
      <Icon size={15} stroke={2.1} />
      <span className="min-w-0 flex-1 truncate">{t(`canvas.materials.${kind.id}`)}</span>
      <span className="text-[11px] text-white/34">{count}</span>
    </button>
  );
}

function materialKindLabel(
  kind: MaterialAssetKind,
  t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string,
) {
  switch (kind) {
    case 'image':
      return t('canvas.materials.image');
    case 'video':
      return t('canvas.materials.video');
    case 'audio':
      return t('canvas.materials.audio');
  }
}

function historyActionLabel(
  action: ProjectHistoryRecord['action'],
  t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string,
) {
  switch (action) {
    case 'created':
      return t('canvas.history.created');
    case 'updated':
      return t('canvas.history.updated');
    case 'restored':
      return t('canvas.history.restored');
  }
}

function formatMaterialDate(
  value: string,
  locale: 'en' | 'zh',
  t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string,
) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t('common.justNow');

  const diffMs = Math.max(0, Date.now() - date.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  const formatter = new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    numeric: 'auto',
  });
  if (minutes < 1) return t('common.justNow');
  if (minutes < 60) return formatter.format(-minutes, 'minute');

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return formatter.format(-hours, 'hour');

  const days = Math.floor(hours / 24);
  if (days < 30) return formatter.format(-days, 'day');

  return date.toLocaleDateString(locale === 'zh' ? 'zh-CN' : 'en-US', {
    month: 'short',
    day: 'numeric',
  });
}

function NodeAddMenu({
  onPickTemplate,
}: {
  onPickTemplate: (template: NodeTemplate) => void;
}) {
  const { t } = useI18n();

  return (
    <div className="ml-3 w-[248px] rounded-[22px] bg-[#202123]/94 p-2.5 shadow-[0_24px_80px_rgba(0,0,0,0.46)] ring-1 ring-white/[0.08] backdrop-blur-2xl">
      <div className="px-2 pb-2 pt-1 text-[12px] font-semibold text-white/48">
        {t('canvas.toolbar.addNode')}
      </div>
      <div className="space-y-1">
        {nodeCatalog.map((template) => {
          const Icon = template.icon;

          return (
            <button
              key={template.kind}
              type="button"
              className="flex w-full items-center gap-2.5 rounded-[14px] px-2 py-2 text-left transition-colors hover:bg-white/[0.08]"
              onClick={() => onPickTemplate(template)}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${template.tone} text-white ring-1 ring-white/[0.1]`}
              >
                <Icon size={18} stroke={2.2} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-white/88">
                  {t(`canvas.nodeKinds.${template.kind}`)}
                </span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function QuickNodeMenu({
  screen,
  handleType,
  fromKind,
  onPick,
  onClose,
}: {
  screen: { x: number; y: number };
  handleType: 'source' | 'target';
  fromKind: NodeKind;
  onPick: (template: NodeTemplate) => void;
  onClose: () => void;
}) {
  const { t } = useI18n();
  const isFromSource = handleType === 'source';
  const compatible = useMemo(() => {
    return nodeCatalog.filter((template) =>
      isFromSource
        ? canConnectNodeKinds(fromKind, template.kind)
        : canConnectNodeKinds(template.kind, fromKind),
    );
  }, [fromKind, isFromSource]);

  useEffect(() => {
    if (compatible.length === 0) onClose();
  }, [compatible.length, onClose]);

  if (compatible.length === 0) return null;

  return (
    <div
      className="fixed inset-0 z-[200]"
      onMouseDown={(event) => {
        event.stopPropagation();
        onClose();
      }}
    >
      <div
        className="absolute flex w-[200px] flex-col gap-0.5 rounded-[18px] bg-[#202123]/96 p-2 text-white shadow-[0_24px_80px_rgba(0,0,0,0.5)] ring-1 ring-white/[0.08] backdrop-blur-2xl"
        style={{
          left: isFromSource ? screen.x : undefined,
          right: isFromSource ? undefined : `calc(100% - ${screen.x}px)`,
          top: screen.y - 10,
          transform: 'translateY(-50%)',
        }}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="px-2 pb-1 pt-1 text-[11px] font-semibold text-white/46">
          {isFromSource ? t('canvas.node.connectTo') : t('canvas.node.sourceFrom')}
        </div>
        {compatible.map((template) => {
          const Icon = template.icon;
          return (
            <button
              key={template.kind}
              type="button"
              className="flex items-center gap-2.5 rounded-[12px] px-2 py-2 text-left transition-colors hover:bg-white/[0.08]"
              onClick={() => onPick(template)}
            >
              <span
                className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${template.tone} text-white ring-1 ring-white/[0.1]`}
              >
                <Icon size={16} stroke={2.2} />
              </span>
              <span className="text-[13px] font-bold text-white/86">
                {t(`canvas.nodeKinds.${template.kind}`)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

const nodeKindStyles: Record<
  NodeKind,
  {
    shell: string;
    icon: string;
    primaryButton: string;
    preview: string;
    glow: string;
    promptPlaceholder: string;
  }
> = {
  text: {
    shell: 'w-[390px]',
    icon: 'bg-[#c9f37c]/14 text-[#d6ff9c] ring-[#c9f37c]/20',
    primaryButton: 'bg-[#d6ff9c] text-[#071009] hover:bg-[#e7ffbf]',
    preview:
      'bg-[linear-gradient(160deg,rgba(201,243,124,0.1),rgba(24,25,26,0.98)_52%,rgba(8,9,10,0.9))]',
    glow: 'shadow-[0_22px_70px_rgba(201,243,124,0.11)]',
    promptPlaceholder: '描述任何你想要生成的内容',
  },
  image: {
    shell: 'w-[380px]',
    icon: 'bg-[#79e4ff]/14 text-[#9beaff] ring-[#79e4ff]/20',
    primaryButton: 'bg-[#9beaff] text-[#041015] hover:bg-[#c3f4ff]',
    preview:
      'bg-[linear-gradient(160deg,rgba(121,228,255,0.12),rgba(28,30,33,0.98)_52%,rgba(8,9,10,0.9))]',
    glow: 'shadow-[0_22px_70px_rgba(121,228,255,0.12)]',
    promptPlaceholder: '描述任何你想要生成的内容',
  },
  video: {
    shell: 'w-[420px]',
    icon: 'bg-[#d7b0ff]/14 text-[#e1c3ff] ring-[#d7b0ff]/20',
    primaryButton: 'bg-[#e1c3ff] text-[#13091d] hover:bg-[#eddcff]',
    preview:
      'bg-[linear-gradient(160deg,rgba(215,176,255,0.12),rgba(28,29,34,0.98)_54%,rgba(8,9,10,0.9))]',
    glow: 'shadow-[0_22px_70px_rgba(215,176,255,0.12)]',
    promptPlaceholder: '描述任何你想要生成的内容',
  },
  audio: {
    shell: 'w-[360px]',
    icon: 'bg-[#f5c76a]/14 text-[#ffd88a] ring-[#f5c76a]/20',
    primaryButton: 'bg-[#ffd88a] text-[#171008] hover:bg-[#ffe6ad]',
    preview:
      'bg-[linear-gradient(160deg,rgba(245,199,106,0.13),rgba(28,28,29,0.98)_52%,rgba(8,9,10,0.9))]',
    glow: 'shadow-[0_22px_70px_rgba(245,199,106,0.13)]',
    promptPlaceholder: '描述任何你想要生成的内容',
  },
};

const waveformBars = [
  { id: 'lead-soft', height: 24 },
  { id: 'lead-peak', height: 44 },
  { id: 'mid-soft', height: 32 },
  { id: 'mid-peak', height: 60 },
  { id: 'breath', height: 38 },
  { id: 'main-peak', height: 72 },
  { id: 'main-soft', height: 42 },
  { id: 'tail-peak', height: 54 },
  { id: 'tail-soft', height: 30 },
  { id: 'close-peak', height: 48 },
  { id: 'close-soft', height: 28 },
  { id: 'end', height: 40 },
];

function ModelPicker({
  disabled,
  kind,
  onChange,
  value,
}: {
  disabled?: boolean;
  kind: NodeKind;
  onChange: (modelId: string) => void;
  value: string;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const models = defaultModels[kind];
  const selected = models.find((model) => model.id === value) ?? models[0];

  return (
    <div
      className="nodrag nopan relative min-w-0 flex-1"
      onBlur={(event) => {
        const nextFocus = event.relatedTarget;
        if (nextFocus instanceof HTMLElement && event.currentTarget.contains(nextFocus)) return;
        setOpen(false);
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={t('canvas.node.chooseModel')}
        disabled={disabled}
        className={`flex h-9 w-full min-w-0 items-center gap-2 rounded-[13px] px-2.5 text-left text-[12px] font-black outline-none ring-1 transition-colors disabled:cursor-not-allowed ${
          open
            ? 'bg-white text-[#111315] ring-white/24'
            : 'bg-white/[0.075] text-white/78 ring-white/[0.08] hover:bg-white/[0.11] hover:text-white'
        } ${disabled ? 'opacity-45' : ''}`}
        onClick={() => setOpen((current) => !current)}
      >
        <IconSparkles size={13} stroke={2.4} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {selected?.label ?? t('canvas.node.chooseModel')}
        </span>
        <IconChevronDown
          size={14}
          stroke={2.5}
          className={`shrink-0 transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div className="absolute bottom-[calc(100%+8px)] left-0 z-[120] max-h-[252px] w-[min(292px,calc(100vw-32px))] overflow-y-auto rounded-[12px] bg-[#2a2b2e]/98 p-1.5 text-white shadow-[0_24px_72px_rgba(0,0,0,0.56)] ring-1 ring-white/[0.14] backdrop-blur-xl">
          {models.map((model) => {
            const selectedModel = model.id === selected?.id;
            return (
              <button
                key={model.id}
                type="button"
                aria-pressed={selectedModel}
                className={`flex w-full items-start gap-2.5 rounded-[10px] px-2.5 py-2 text-left transition-colors ${
                  selectedModel ? 'bg-white/[0.12]' : 'hover:bg-white/[0.07]'
                }`}
                onClick={() => {
                  onChange(model.id);
                  setOpen(false);
                }}
                onMouseDown={(event) => event.preventDefault()}
              >
                <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">
                  {selectedModel ? (
                    <IconCheck size={15} className="text-white" stroke={3} />
                  ) : (
                    <IconSparkles size={13} className="text-white/58" stroke={2.4} />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-black text-white/90">
                    {model.label}
                  </span>
                  <span className="mt-1 flex min-w-0 flex-wrap gap-1">
                    {model.badges.map((badge) => (
                      <span
                        key={badge}
                        className="rounded-full bg-white/[0.08] px-1.5 py-0.5 text-[10px] font-bold text-white/48"
                      >
                        {badge.startsWith('canvas.') ? t(badge) : badge}
                      </span>
                    ))}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

function FrameImageSlot({
  image,
  label,
  fromUpstream,
  draggable,
  dropActive,
  onClear,
  onUpload,
  onDragStart,
  onDragEnd,
  onDrop,
}: {
  image: string;
  label: string;
  fromUpstream?: boolean;
  draggable?: boolean;
  dropActive?: boolean;
  onClear?: () => void;
  onUpload: (event: ChangeEvent<HTMLInputElement>) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  onDrop?: () => void;
}) {
  const { t } = useI18n();
  const canDrag = Boolean(draggable && image);
  return (
    <div
      className={`nodrag group/upload relative h-[58px] w-[74px] shrink-0 overflow-hidden rounded-[10px] bg-[#2d2e30]/86 text-white/42 ring-1 transition-colors hover:bg-white/[0.08] hover:text-white/74 ${
        dropActive ? 'ring-2 ring-[#79e4ff]/70' : 'ring-white/[0.07]'
      } ${canDrag ? 'cursor-grab active:cursor-grabbing' : ''}`}
      draggable={canDrag}
      onDragStart={
        canDrag
          ? (event) => {
              event.dataTransfer.effectAllowed = 'move';
              event.dataTransfer.setData('text/plain', label);
              onDragStart?.();
            }
          : undefined
      }
      onDragEnd={canDrag ? onDragEnd : undefined}
      onDragOver={onDrop ? (event) => event.preventDefault() : undefined}
      onDrop={
        onDrop
          ? (event) => {
              event.preventDefault();
              onDrop();
            }
          : undefined
      }
    >
      <label className="absolute inset-0 flex cursor-pointer items-center justify-center">
        {image ? (
          <img
            alt={label}
            decoding="async"
            draggable={false}
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover opacity-75 transition-opacity group-hover/upload:opacity-55"
            src={image}
          />
        ) : (
          <IconUpload size={18} stroke={2.2} />
        )}
        <span className="pointer-events-none absolute inset-x-0 bottom-0 bg-black/50 py-1 text-center text-[10px] font-black text-white/78">
          {image ? label : t('canvas.node.upload')}
        </span>
        <input className="sr-only" type="file" accept="image/*" onChange={onUpload} />
      </label>
      {fromUpstream ? (
        <span className="pointer-events-none absolute left-1 top-1 z-10 rounded-full bg-[#79e4ff]/22 px-1.5 py-0.5 text-[9px] font-black text-[#c9f1ff] ring-1 ring-[#79e4ff]/30">
          {t('canvas.node.upstream')}
        </span>
      ) : null}
      {image && onClear ? (
        <button
          type="button"
          aria-label={t('canvas.node.clearSlot', { label })}
          className="absolute right-1 top-1 z-10 rounded-full bg-black/54 px-1.5 py-0.5 text-[10px] font-black text-white/78 opacity-0 transition-opacity hover:bg-black/72 group-hover/upload:opacity-100"
          onClick={(event) => {
            event.stopPropagation();
            onClear();
          }}
        >
          {t('canvas.node.clear')}
        </button>
      ) : null}
    </div>
  );
}

function ParamPills<T extends string | number>({
  label,
  options,
  value,
  onSelect,
  format,
}: {
  label: string;
  options: readonly T[];
  value: T;
  onSelect: (option: T) => void;
  format?: (option: T) => string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-9 shrink-0 text-[10px] font-black text-white/40">{label}</span>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5 rounded-[10px] bg-[#2d2e30]/86 p-1.5 ring-1 ring-white/[0.07]">
        {options.map((option) => (
          <button
            key={String(option)}
            type="button"
            className={`nodrag h-7 rounded-[9px] px-2 text-[11px] font-black transition-colors ${
              value === option
                ? 'bg-white text-[#111315]'
                : 'text-white/46 hover:bg-white/[0.08] hover:text-white/76'
            }`}
            onClick={() => onSelect(option)}
          >
            {format ? format(option) : String(option)}
          </button>
        ))}
      </div>
    </div>
  );
}

function LumenFlowNode({ data, id, selected }: NodeProps<LumenNode>) {
  const { t } = useI18n();
  const { setNodes: setFlowNodes } = useReactFlow<LumenNode, LumenEdge>();
  const {
    runSingleNode,
    cancelNodes,
    updateNodeData,
    uploadCanvasMedia,
    connectionError,
    canRunNode,
  } = useContext(CanvasActionsContext);
  const styles = nodeKindStyles[data.kind];
  const status = data.status ?? 'idle';
  const upstreamOutputCount =
    typeof data.upstreamOutputCount === 'number' ? data.upstreamOutputCount : 0;
  const modelId = resolveModelId(data);
  const progress = data.progress ?? (status === 'running' ? 0.45 : 0);
  const canRun = canRunNode(id);
  const isNodeBusy = isWorkflowNodeBusy(status);
  const progressPercent = Math.max(isNodeBusy ? 14 : 0, Math.round(progress * 100));
  const nodeTitle = getNodeTitle(data, t);
  const inputImage = getSettingString(data.settings, 'inputImage');
  const inputLastFrameImage = getSettingString(data.settings, 'inputLastFrameImage');
  const aspectRatio = getAspectRatio(data.settings);
  const acceptsImageInput = data.kind === 'image' || data.kind === 'video';
  const isVideo = data.kind === 'video';
  const isVideoEdit = isVideo && modelId === 'lumen-video-edit';
  const videoDuration = getVideoDuration(data.settings);
  const videoResolution = getVideoResolution(data.settings);
  const editVideoResolution = editVideoResolutionOptions.includes(
    videoResolution as (typeof editVideoResolutionOptions)[number],
  )
    ? (videoResolution as (typeof editVideoResolutionOptions)[number])
    : '720p';

  // 读取上游图片节点的输出；上游图片只有成对时才展示为首/尾帧。
  const incomingConnections = useNodeConnections({ handleType: 'target' });
  const upstreamNodeIds = useMemo(
    () => incomingConnections.map((connection) => connection.source),
    [incomingConnections],
  );
  const upstreamNodesData = useNodesData<LumenNode>(upstreamNodeIds);
  const upstreamImages = useMemo(() => {
    if (!isVideo) return [] as string[];
    const result: string[] = [];
    for (const upstream of upstreamNodesData ?? []) {
      if (upstream?.data.kind !== 'image') continue;
      const output = upstream.data.output?.trim();
      if (output) result.push(output);
    }
    return result;
  }, [isVideo, upstreamNodesData]);
  const upstreamVideos = useMemo(() => {
    if (!isVideoEdit) return [] as string[];
    const result: string[] = [];
    for (const upstream of upstreamNodesData ?? []) {
      if (upstream?.data.kind !== 'video') continue;
      const output = upstream.data.output?.trim();
      if (output) result.push(output);
    }
    return result;
  }, [isVideoEdit, upstreamNodesData]);

  const { first: resolvedFirstFrame, last: resolvedLastFrame } = resolveFrames(
    inputImage,
    inputLastFrameImage,
    upstreamImages,
  );
  const firstFromUpstream = !inputImage && Boolean(resolvedFirstFrame);
  const lastFromUpstream = !inputLastFrameImage && Boolean(resolvedLastFrame);

  const selectSelf = useCallback(() => {
    setFlowNodes((currentNodes) =>
      currentNodes.map((node) => ({ ...node, selected: node.id === id })),
    );
  }, [id, setFlowNodes]);

  const handleNodePointerDownCapture = useCallback(
    (event: { target: EventTarget | null }) => {
      if (!(event.target instanceof Element)) return;
      if (event.target.closest('[data-skip-node-select="true"]')) return;
      if (event.target.closest('.react-flow__handle')) return;

      selectSelf();
    },
    [selectSelf],
  );

  const updateSettings = useCallback(
    (patch: Record<string, unknown>) => {
      updateNodeData(id, { settings: { ...data.settings, ...patch } });
    },
    [data.settings, id, updateNodeData],
  );

  const handleAssetUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>, settingKey = 'inputImage') => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      const previousValue = getSettingString(data.settings, settingKey);
      const previewUrl = URL.createObjectURL(file);
      updateSettings({ [settingKey]: previewUrl });
      try {
        const uploadedUrl = await uploadCanvasMedia(file, 'image', id);
        updateSettings({ [settingKey]: uploadedUrl });
      } catch (error) {
        console.error(error);
        updateSettings({ [settingKey]: previousValue });
      } finally {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [data.settings, id, updateSettings, uploadCanvasMedia],
  );

  const handleOutputMediaUpload = useCallback(
    async (file: File, kind: MaterialAssetKind) => {
      const previousValue = data.output ?? null;
      const previewUrl = URL.createObjectURL(file);
      updateNodeData(id, { output: previewUrl });
      try {
        const uploadedUrl = await uploadCanvasMedia(file, kind, id);
        updateNodeData(id, { output: uploadedUrl });
      } catch (error) {
        console.error(error);
        updateNodeData(id, { output: previousValue });
      } finally {
        URL.revokeObjectURL(previewUrl);
      }
    },
    [data.output, id, updateNodeData, uploadCanvasMedia],
  );

  const dragSourceRef = useRef<'first' | 'last' | null>(null);
  const [frameDragActive, setFrameDragActive] = useState(false);

  // 交换首尾帧：把当前解析出的两帧固化到显式设置里（上游图片也一并固化），保证交换可持久化。
  const handleSwapFrames = useCallback(() => {
    if (!resolvedFirstFrame || !resolvedLastFrame) return;
    updateSettings({ inputImage: resolvedLastFrame, inputLastFrameImage: resolvedFirstFrame });
  }, [resolvedFirstFrame, resolvedLastFrame, updateSettings]);

  const handleFrameDragStart = useCallback((slot: 'first' | 'last') => {
    dragSourceRef.current = slot;
    setFrameDragActive(true);
  }, []);

  const handleFrameDragEnd = useCallback(() => {
    dragSourceRef.current = null;
    setFrameDragActive(false);
  }, []);

  const handleFrameDrop = useCallback(
    (target: 'first' | 'last') => {
      const source = dragSourceRef.current;
      dragSourceRef.current = null;
      setFrameDragActive(false);
      if (!source || source === target) return;
      handleSwapFrames();
    },
    [handleSwapFrames],
  );

  const handleSelectDuration = useCallback(
    (duration: (typeof videoDurationOptions)[number]) => {
      // 选择短时长时，若当前清晰度要求 8s（1080p/4k），自动降回 720p。
      if (duration !== 8 && resolutionRequiresEightSeconds(videoResolution)) {
        updateSettings({ duration, resolution: '720p' });
        return;
      }
      updateSettings({ duration });
    },
    [updateSettings, videoResolution],
  );

  const handleSelectResolution = useCallback(
    (resolution: (typeof videoResolutionOptions)[number]) => {
      // 1080p/4k 仅支持 8s，自动把时长拉到 8s。
      if (resolutionRequiresEightSeconds(resolution)) {
        updateSettings({ resolution, duration: 8 });
        return;
      }
      updateSettings({ resolution });
    },
    [updateSettings],
  );

  const handleRun = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!canRun || isNodeBusy) return;
      if (!data.modelId) updateNodeData(id, { modelId });
      runSingleNode(id);
    },
    [canRun, data.modelId, id, isNodeBusy, modelId, runSingleNode, updateNodeData],
  );

  const handleStop = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!isNodeBusy) return;
      if (!window.confirm(t('canvas.node.cancelConfirm'))) return;
      cancelNodes([id]);
    },
    [cancelNodes, id, isNodeBusy, t],
  );

  const handlePromptKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      // Prevent React Flow from intercepting keys (esp. Space for IME)
      event.stopPropagation();

      // Don't react to keys while IME is composing (Chinese, Japanese, Korean input)
      if (event.nativeEvent.isComposing || event.keyCode === 229) {
        return;
      }

      if (event.key === 'Escape') {
        event.currentTarget.blur();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        if (!canRun || isNodeBusy) return;
        runSingleNode(id);
      }
    },
    [canRun, id, isNodeBusy, runSingleNode],
  );

  return (
    <div
      className={`group relative ${styles.shell} text-white`}
      aria-busy={isNodeBusy}
      onMouseDownCapture={handleNodePointerDownCapture}
      onPointerDownCapture={handleNodePointerDownCapture}
    >
      <div
        className={`pointer-events-none absolute -top-3 right-4 z-[80] flex h-6 min-w-6 items-center justify-center rounded-full px-2 text-[11px] font-black shadow-[0_10px_24px_rgba(0,0,0,0.28)] ring-1 ${
          upstreamOutputCount > 0
            ? 'bg-white text-[#111315] ring-white/40'
            : 'bg-[#2d2e30] text-white/34 ring-white/[0.08]'
        }`}
      >
        {upstreamOutputCount}
      </div>
      <Handle
        type="target"
        position={Position.Left}
        className="!left-[-7px] !z-[70] !h-3 !w-3 !cursor-crosshair !rounded-full !border-[2px] !border-white/72 !bg-[#202123] !shadow-none hover:!scale-[1.35] !transition-transform"
      />

      <div
        className={`lumen-node-card relative overflow-hidden rounded-[13px] bg-[#202123] ring-1 transition-all duration-200 ${
          isNodeBusy
            ? 'lumen-node-card--running ring-[#79e4ff]/42 shadow-[0_18px_60px_rgba(0,0,0,0.42),0_0_34px_rgba(121,228,255,0.12)]'
            : selected
              ? `ring-white/28 ${styles.glow}`
              : 'ring-white/[0.1] hover:ring-white/[0.16]'
        }`}
        data-run-state={isNodeBusy ? status : undefined}
      >
        <div className="border-b border-white/[0.06] p-2.5">
          <input
            aria-label={t('canvas.node.title')}
            className="nodrag nopan mb-2 h-6 w-full bg-transparent px-1 text-[12px] font-bold text-white/78 outline-none placeholder:text-white/24"
            onChange={(event) => updateNodeData(id, { title: event.target.value })}
            value={nodeTitle}
          />
          <div
            className={`relative overflow-hidden rounded-[10px] ${styles.preview} ${
              isNodeBusy ? 'lumen-node-preview--running' : ''
            }`}
          >
            <NodeOutputEditor
              data={data}
              onChange={(output) => updateNodeData(id, { output: output || null })}
              onMediaUpload={handleOutputMediaUpload}
            />
            {isNodeBusy ? <div className="lumen-node-running-overlay absolute inset-0" /> : null}
            {isNodeBusy ? (
              <div className="absolute inset-x-0 bottom-0 h-1 bg-white/[0.06]">
                <div
                  className="lumen-node-progress-bar h-full rounded-r-full transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
            ) : null}
          </div>
        </div>

        {selected ? (
          <div className="bg-[#242527]/95 p-2.5">
            {acceptsImageInput ? (
              isVideo ? (
                isVideoEdit ? (
                  <div className="mb-2 space-y-2">
                    <div className="flex items-center justify-between rounded-[10px] bg-[#2d2e30]/86 px-3 py-2 ring-1 ring-white/[0.07]">
                      <span className="text-[10px] font-black text-white/40">
                        {t('canvas.node.clips')}
                      </span>
                      <span className="rounded-full bg-white/[0.08] px-2 py-1 text-[11px] font-black text-white/72">
                        {upstreamVideos.length}
                      </span>
                    </div>
                    <ParamPills
                      label={t('canvas.node.ratio')}
                      options={aspectRatioOptions}
                      value={aspectRatio as (typeof aspectRatioOptions)[number]}
                      onSelect={(ratio) => updateSettings({ aspectRatio: ratio })}
                    />
                    <ParamPills
                      label={t('canvas.node.resolution')}
                      options={editVideoResolutionOptions}
                      value={editVideoResolution}
                      onSelect={(resolution) => updateSettings({ resolution })}
                    />
                  </div>
                ) : (
                  <div className="mb-2 space-y-2">
                    <div className="flex items-center gap-1.5">
                      <FrameImageSlot
                        image={resolvedFirstFrame}
                        label={t('canvas.node.firstFrame')}
                        fromUpstream={firstFromUpstream}
                        draggable
                        dropActive={frameDragActive}
                        onClear={inputImage ? () => updateSettings({ inputImage: '' }) : undefined}
                        onUpload={(event) => handleAssetUpload(event, 'inputImage')}
                        onDragStart={() => handleFrameDragStart('first')}
                        onDragEnd={handleFrameDragEnd}
                        onDrop={() => handleFrameDrop('first')}
                      />
                      <button
                        type="button"
                        aria-label={t('canvas.node.swapFrames')}
                        title={t('canvas.node.swapFrames')}
                        disabled={!resolvedFirstFrame || !resolvedLastFrame}
                        className="nodrag flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-white/64 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.16] hover:text-white disabled:cursor-not-allowed disabled:opacity-30"
                        onClick={handleSwapFrames}
                      >
                        <IconArrowsExchange2 size={15} stroke={2.3} />
                      </button>
                      <FrameImageSlot
                        image={resolvedLastFrame}
                        label={t('canvas.node.lastFrame')}
                        fromUpstream={lastFromUpstream}
                        draggable
                        dropActive={frameDragActive}
                        onClear={
                          inputLastFrameImage
                            ? () => updateSettings({ inputLastFrameImage: '' })
                            : undefined
                        }
                        onUpload={(event) => handleAssetUpload(event, 'inputLastFrameImage')}
                        onDragStart={() => handleFrameDragStart('last')}
                        onDragEnd={handleFrameDragEnd}
                        onDrop={() => handleFrameDrop('last')}
                      />
                      {inputImage || inputLastFrameImage ? (
                        <button
                          type="button"
                          className="nodrag ml-auto h-7 self-start rounded-[9px] px-2 text-[11px] font-black text-white/34 transition-colors hover:bg-white/[0.08] hover:text-white/76"
                          onClick={() =>
                            updateSettings({ inputImage: '', inputLastFrameImage: '' })
                          }
                        >
                          {t('canvas.node.clear')}
                        </button>
                      ) : null}
                    </div>
                    <ParamPills
                      label={t('canvas.node.ratio')}
                      options={aspectRatioOptions}
                      value={aspectRatio as (typeof aspectRatioOptions)[number]}
                      onSelect={(ratio) => updateSettings({ aspectRatio: ratio })}
                    />
                    <ParamPills
                      label={t('canvas.node.duration')}
                      options={videoDurationOptions}
                      value={videoDuration}
                      onSelect={handleSelectDuration}
                      format={(seconds) => `${seconds}s`}
                    />
                    <ParamPills
                      label={t('canvas.node.resolution')}
                      options={videoResolutionOptions}
                      value={videoResolution}
                      onSelect={handleSelectResolution}
                    />
                  </div>
                )
              ) : (
                <div className="mb-2 grid grid-cols-[auto_1fr] gap-2">
                  <FrameImageSlot
                    image={inputImage}
                    label={t('canvas.node.inputImage')}
                    onClear={inputImage ? () => updateSettings({ inputImage: '' }) : undefined}
                    onUpload={(event) => handleAssetUpload(event, 'inputImage')}
                  />
                  <div className="flex min-w-0 flex-wrap items-center gap-1.5 rounded-[10px] bg-[#2d2e30]/86 p-1.5 ring-1 ring-white/[0.07]">
                    {aspectRatioOptions.map((ratio) => (
                      <button
                        key={ratio}
                        type="button"
                        className={`nodrag h-7 rounded-[9px] px-2 text-[11px] font-black transition-colors ${
                          aspectRatio === ratio
                            ? 'bg-white text-[#111315]'
                            : 'text-white/46 hover:bg-white/[0.08] hover:text-white/76'
                        }`}
                        onClick={() => updateSettings({ aspectRatio: ratio })}
                      >
                        {ratio}
                      </button>
                    ))}
                    {inputImage ? (
                      <button
                        type="button"
                        className="nodrag ml-auto h-7 rounded-[9px] px-2 text-[11px] font-black text-white/34 transition-colors hover:bg-white/[0.08] hover:text-white/76"
                        onClick={() => updateSettings({ inputImage: '' })}
                      >
                        {t('canvas.node.clear')}
                      </button>
                    ) : null}
                  </div>
                </div>
              )
            ) : null}
            <div className="rounded-[10px] bg-[#2d2e30]/86 p-3 ring-1 ring-white/[0.07]">
              <ImeTextarea
                aria-label={t('canvas.node.input')}
                onValueChange={(next) => updateNodeData(id, { prompt: next })}
                onKeyDown={handlePromptKeyDown}
                className="nodrag nowheel block min-h-[112px] w-full resize-none bg-transparent text-[13px] leading-relaxed text-white/78 outline-none placeholder:text-white/32"
                placeholder={t('canvas.node.promptPlaceholder')}
                value={data.prompt}
              />
            </div>

            <div className="mt-2 flex items-center gap-2">
              <ModelPicker
                disabled={isNodeBusy}
                kind={data.kind}
                onChange={(nextModelId) => updateNodeData(id, { modelId: nextModelId })}
                value={modelId}
              />
              <button
                type="button"
                aria-label={isNodeBusy ? t('canvas.node.stop') : t('canvas.node.run')}
                aria-busy={isNodeBusy}
                title={isNodeBusy ? t('canvas.node.stop') : t('canvas.node.run')}
                disabled={!isNodeBusy && !canRun}
                className={`nodrag flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-black shadow-[0_12px_28px_rgba(0,0,0,0.22)] transition-colors disabled:cursor-not-allowed ${
                  isNodeBusy
                    ? 'bg-white text-[#111315] shadow-[0_0_28px_rgba(121,228,255,0.25),0_12px_28px_rgba(0,0,0,0.28)]'
                    : `${styles.primaryButton} disabled:opacity-30`
                }`}
                onClick={isNodeBusy ? handleStop : handleRun}
              >
                {isNodeBusy ? (
                  <IconPlayerStop size={16} stroke={2.6} />
                ) : (
                  <IconPlayerPlay size={15} stroke={2.5} />
                )}
              </button>
            </div>

            {status === 'error' && data.error ? (
              <div className="mt-2 rounded-[12px] bg-[#ff5d73]/10 px-3 py-2 text-[12px] font-semibold text-[#ffabb6] ring-1 ring-[#ff5d73]/16">
                {data.error}
              </div>
            ) : null}

            {connectionError ? (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-white/30">
                <IconAlertTriangle size={13} stroke={2.2} />
                {connectionError}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!right-[-7px] !z-[70] !h-3 !w-3 !cursor-crosshair !rounded-full !border-[2px] !border-white/72 !bg-[#202123] !shadow-none hover:!scale-[1.35] !transition-transform"
      />
    </div>
  );
}

function NodeOutputEditor({
  data,
  onChange,
  onMediaUpload,
}: {
  data: LumenNodeData;
  onChange: (output: string) => void;
  onMediaUpload: (file: File, kind: MaterialAssetKind) => Promise<void>;
}) {
  const { t } = useI18n();
  const output = data.output ?? '';
  const trimmedOutput = output.trim();
  const previewAspectRatio = getPreviewAspectRatio(data);

  if (data.kind === 'text') {
    return <TextOutputEditor onChange={onChange} output={output} />;
  }

  if (data.kind === 'image') {
    if (trimmedOutput && (trimmedOutput.startsWith('data:image') || isHttpUrl(trimmedOutput))) {
      return (
        <MediaOutputFrame
          aspectRatio={previewAspectRatio}
          kind="image"
          onUpload={onMediaUpload}
          url={trimmedOutput}
        >
          <img
            alt={t('canvas.node.imageAlt')}
            className="pointer-events-none absolute inset-0 h-full w-full object-cover"
            decoding="async"
            draggable={false}
            loading="lazy"
            onError={(event) => {
              event.currentTarget.style.opacity = '0';
            }}
            src={trimmedOutput}
          />
        </MediaOutputFrame>
      );
    }

    return (
      <MediaOutputUpload aspectRatio={previewAspectRatio} kind="image" onUpload={onMediaUpload} />
    );
  }

  if (
    trimmedOutput &&
    data.kind === 'video' &&
    (trimmedOutput.startsWith('data:video') || isHttpUrl(trimmedOutput))
  ) {
    return (
      <MediaOutputFrame
        aspectRatio={previewAspectRatio}
        kind="video"
        onUpload={onMediaUpload}
        url={trimmedOutput}
      >
        <video
          // transform-gpu + contain:paint 把视频提升到独立合成层，播放重绘不再波及整个节点/画布
          className="absolute inset-0 h-full w-full transform-gpu cursor-grab object-cover active:cursor-grabbing"
          style={{ contain: 'paint' }}
          controls
          playsInline
          preload="metadata"
          src={trimmedOutput}
        >
          <track kind="captions" />
        </video>
      </MediaOutputFrame>
    );
  }

  if (
    trimmedOutput &&
    data.kind === 'audio' &&
    (trimmedOutput.startsWith('data:audio') || isHttpUrl(trimmedOutput))
  ) {
    return (
      <MediaOutputFrame kind="audio" onUpload={onMediaUpload} url={trimmedOutput}>
        <div className="pointer-events-none flex min-h-[104px] w-full flex-col justify-center gap-3 px-3">
          <div className="flex items-center gap-1.5">
            {waveformBars.map((bar) => (
              <span
                key={bar.id}
                className="w-1.5 rounded-full bg-white/28"
                style={{ height: bar.height }}
              />
            ))}
          </div>
        </div>
        <audio
          className="nodrag nopan absolute inset-x-3 bottom-3 h-8"
          controls
          src={trimmedOutput}
        >
          <track kind="captions" />
        </audio>
      </MediaOutputFrame>
    );
  }

  return (
    <MediaOutputUpload
      aspectRatio={data.kind === 'video' ? previewAspectRatio : undefined}
      kind={data.kind}
      onUpload={onMediaUpload}
    />
  );
}

function getPreviewAspectRatio(data: LumenNodeData): string | undefined {
  if (
    typeof data.previewAspectRatio === 'string' &&
    isSupportedAspectRatio(data.previewAspectRatio)
  ) {
    return data.previewAspectRatio;
  }
  if (data.kind !== 'image' && data.kind !== 'video') return undefined;
  return getAspectRatio(data.settings);
}

function TextOutputEditor({
  onChange,
  output,
}: {
  onChange: (output: string) => void;
  output: string;
}) {
  const { t } = useI18n();
  const [editing, setEditing] = useState(false);
  const hasOutput = output.trim().length > 0;

  if (editing) {
    return (
      <ImeTextarea
        aria-label={t('canvas.node.output')}
        autoFocus
        className="nodrag nowheel block min-h-[104px] w-full resize-none bg-transparent px-3 py-2.5 text-[13px] leading-relaxed text-white/78 outline-none placeholder:text-white/26"
        onBlur={() => setEditing(false)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.currentTarget.blur();
          }
        }}
        onValueChange={onChange}
        placeholder={t('canvas.node.output')}
        value={output}
      />
    );
  }

  return (
    <div
      className="min-h-[104px] w-full cursor-grab whitespace-pre-wrap px-3 py-2.5 text-[13px] leading-relaxed text-white/78 outline-none transition-colors hover:text-white/86 active:cursor-grabbing"
      onDoubleClick={(event) => {
        event.stopPropagation();
        setEditing(true);
      }}
    >
      <span className={hasOutput ? undefined : 'text-white/28'}>
        {hasOutput ? output : t('canvas.node.output')}
      </span>
    </div>
  );
}

function MediaOutputFrame({
  aspectRatio,
  children,
  kind,
  onUpload,
  url,
}: {
  aspectRatio?: string;
  children: ReactNode;
  kind: MaterialAssetKind;
  onUpload: (file: File, kind: MaterialAssetKind) => Promise<void>;
  url?: string;
}) {
  return (
    <div
      className={`group/output relative w-full cursor-grab overflow-hidden active:cursor-grabbing ${
        aspectRatio ? '' : 'min-h-[104px]'
      }`}
      style={aspectRatio ? { aspectRatio: toCssAspectRatio(aspectRatio) } : undefined}
    >
      {children}
      {url ? <MediaOutputOpenButton url={url} /> : null}
      <MediaOutputUploadButton kind={kind} onUpload={onUpload} />
    </div>
  );
}

function MediaOutputUpload({
  aspectRatio,
  kind,
  onUpload,
}: {
  aspectRatio?: string;
  kind: MaterialAssetKind;
  onUpload: (file: File, kind: MaterialAssetKind) => Promise<void>;
}) {
  const { t } = useI18n();
  const [uploading, setUploading] = useState(false);
  const Icon = mediaOutputIcon(kind);

  return (
    <div
      className={`group/output relative flex w-full cursor-grab flex-col items-center justify-center gap-2 px-3 py-2.5 text-white/30 transition-colors hover:text-white/64 active:cursor-grabbing ${
        aspectRatio ? '' : 'min-h-[104px]'
      }`}
      style={aspectRatio ? { aspectRatio: toCssAspectRatio(aspectRatio) } : undefined}
    >
      <div className="pointer-events-none flex flex-col items-center justify-center gap-2">
        {uploading ? (
          <IconLoader2 size={26} stroke={1.8} className="animate-spin opacity-70" />
        ) : (
          <Icon size={30} stroke={1.6} className="opacity-70" />
        )}
        <span className="text-[12px] font-bold">
          {uploading ? t('materials.uploading') : t('canvas.node.upload')}
        </span>
      </div>
      <MediaOutputUploadButton kind={kind} onUpload={onUpload} onUploadingChange={setUploading} />
    </div>
  );
}

function MediaOutputOpenButton({ url }: { url: string }) {
  const { t } = useI18n();
  return (
    <button
      type="button"
      aria-label={t('canvas.node.openOutput')}
      title={t('canvas.node.openOutput')}
      data-skip-node-select="true"
      className="nodrag nopan absolute left-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/52 text-white/86 ring-1 ring-white/[0.18] backdrop-blur transition-colors hover:bg-black/70 hover:text-white"
      onClick={(event) => {
        event.stopPropagation();
        const opened = window.open(url, '_blank', 'noopener,noreferrer');
        if (!opened) window.location.assign(url);
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <IconExternalLink size={14} stroke={2.2} />
    </button>
  );
}

function toCssAspectRatio(value: string): string {
  return value.replace(':', ' / ');
}

function MediaOutputUploadButton({
  kind,
  onUpload,
  onUploadingChange,
}: {
  kind: MaterialAssetKind;
  onUpload: (file: File, kind: MaterialAssetKind) => Promise<void>;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const { t } = useI18n();
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const setUploadState = useCallback(
    (nextUploading: boolean) => {
      setUploading(nextUploading);
      onUploadingChange?.(nextUploading);
    },
    [onUploadingChange],
  );

  const handleUpload = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;
      setUploadState(true);
      try {
        await onUpload(file, kind);
      } finally {
        setUploadState(false);
      }
    },
    [kind, onUpload, setUploadState],
  );

  return (
    <>
      <button
        type="button"
        className="nodrag nopan absolute right-2 top-2 z-10 flex h-8 w-8 items-center justify-center rounded-full bg-black/45 text-white/68 ring-1 ring-white/[0.12] transition-colors hover:bg-black/62 hover:text-white"
        aria-label={t('canvas.node.upload')}
        disabled={uploading}
        onClick={(event) => {
          event.stopPropagation();
          inputRef.current?.click();
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {uploading ? (
          <IconLoader2 size={15} stroke={2.2} className="animate-spin" />
        ) : (
          <IconUpload size={15} stroke={2.2} />
        )}
      </button>
      <input
        ref={inputRef}
        className="sr-only"
        type="file"
        accept={mediaAccept(kind)}
        disabled={uploading}
        onChange={handleUpload}
      />
    </>
  );
}

function mediaAccept(kind: MaterialAssetKind): string {
  switch (kind) {
    case 'image':
      return 'image/*';
    case 'video':
      return 'video/*';
    case 'audio':
      return 'audio/*';
  }
}

function mediaOutputIcon(kind: MaterialAssetKind): typeof IconPlus {
  switch (kind) {
    case 'image':
      return IconPhoto;
    case 'video':
      return IconVideo;
    case 'audio':
      return IconMusic;
  }
}

function isHttpUrl(value: string): boolean {
  return value.startsWith('http://') || value.startsWith('https://');
}

function LumenSmoothEdge(props: EdgeProps<LumenEdge>) {
  const { t } = useI18n();
  const { id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, selected } =
    props;
  const [isHovered, setIsHovered] = useState(false);
  const { deleteElements } = useReactFlow<LumenNode, LumenEdge>();
  const sourceOutputCount =
    typeof props.data?.sourceOutputCount === 'number' ? props.data.sourceOutputCount : 0;
  const sourceKind =
    props.data?.sourceKind === 'text' ||
    props.data?.sourceKind === 'image' ||
    props.data?.sourceKind === 'video' ||
    props.data?.sourceKind === 'audio'
      ? props.data.sourceKind
      : null;
  const sourceLabel = sourceKind ? t(`canvas.nodeKinds.${sourceKind}`) : t('canvas.node.output');
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
    curvature: 0.42,
  });

  const handleDelete = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      void deleteElements({ edges: [{ id }] });
    },
    [deleteElements, id],
  );

  return (
    <g onMouseEnter={() => setIsHovered(true)} onMouseLeave={() => setIsHovered(false)}>
      <path
        d={edgePath}
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeLinecap="round"
        strokeWidth={selected ? 9 : 7}
        style={{ pointerEvents: 'none' }}
      />
      <path
        d={edgePath}
        fill="none"
        stroke={selected ? 'rgba(255,255,255,0.74)' : 'rgba(255,255,255,0.34)'}
        strokeLinecap="round"
        strokeWidth={selected ? 2.2 : 1.6}
        style={{ pointerEvents: 'none' }}
      />
      <BaseEdge id={id} interactionWidth={20} path={edgePath} style={{ stroke: 'transparent' }} />
      <foreignObject
        height={32}
        style={{ overflow: 'visible', pointerEvents: 'all' }}
        width={118}
        x={labelX - 59}
        y={labelY - 16}
      >
        <div className="flex h-8 items-center justify-center gap-1">
          <span
            className={`nodrag nopan flex h-7 min-w-0 items-center gap-1 rounded-full px-2.5 text-[11px] font-black shadow-[0_10px_24px_rgba(0,0,0,0.28)] ring-1 ${
              sourceOutputCount > 0
                ? 'bg-white text-[#111315] ring-white/40'
                : 'bg-[#2d2e30]/96 text-white/36 ring-white/[0.08]'
            }`}
          >
            <span className="max-w-[54px] truncate">{sourceLabel}</span>
            <span>x{sourceOutputCount}</span>
          </span>
          <button
            type="button"
            aria-label={t('canvas.node.deleteEdge')}
            className={`nodrag nopan flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#ff5d73] text-white shadow-[0_10px_24px_rgba(255,93,115,0.28)] transition-opacity hover:opacity-100 ${
              selected || isHovered ? 'opacity-100' : 'opacity-0'
            }`}
            onClick={handleDelete}
          >
            <IconTrash size={14} stroke={2.2} />
          </button>
        </div>
      </foreignObject>
    </g>
  );
}

function LumenConnectionLine({
  fromX,
  fromY,
  fromPosition,
  toX,
  toY,
  toPosition,
}: ConnectionLineComponentProps<LumenNode>) {
  const [edgePath] = getBezierPath({
    sourceX: fromX,
    sourceY: fromY,
    sourcePosition: fromPosition,
    targetX: toX,
    targetY: toY,
    targetPosition: toPosition,
    curvature: 0.42,
  });

  return (
    <g>
      <path
        d={edgePath}
        fill="none"
        stroke="rgba(255,255,255,0.1)"
        strokeLinecap="round"
        strokeWidth={7}
      />
      <path
        d={edgePath}
        fill="none"
        stroke="rgba(255,255,255,0.58)"
        strokeLinecap="round"
        strokeWidth={1.8}
      />
    </g>
  );
}

function ControlTooltip({ label }: { label: string }) {
  return (
    <span className="pointer-events-none absolute bottom-[calc(100%+10px)] left-1/2 hidden -translate-x-1/2 whitespace-nowrap rounded-xl bg-[#303235]/96 px-3 py-1.5 text-[12px] font-bold text-white shadow-[0_14px_34px_rgba(0,0,0,0.36)] ring-1 ring-white/[0.08] group-hover:block">
      {label}
    </span>
  );
}

function BottomControls({
  canArrange,
  onArrange,
  onDeleteSelected,
  onSelectAll,
  selectedElementCount,
}: {
  canArrange: boolean;
  onArrange: () => void;
  onDeleteSelected: () => void;
  onSelectAll: () => void;
  selectedElementCount: number;
}) {
  const { t } = useI18n();
  const reactFlow = useReactFlow<LumenNode, LumenEdge>();
  const [zoom, setZoom] = useState(100);

  useOnViewportChange({
    onChange: ({ zoom: nextZoom }) => setZoom(Math.round(nextZoom * 100)),
  });

  return (
    <div className="absolute bottom-5 left-5 z-30 flex items-center gap-2 rounded-2xl bg-[#17191c]/88 p-2 text-white/64 shadow-[0_16px_48px_rgba(0,0,0,0.4)] ring-1 ring-white/[0.08] backdrop-blur-xl">
      <button
        type="button"
        aria-label={t('canvas.toolbar.fit')}
        onClick={() => reactFlow.fitView({ padding: 0.28, duration: 260 })}
        className="group relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <IconLayoutGrid size={17} stroke={2.1} />
        <ControlTooltip label={t('canvas.toolbar.fit')} />
      </button>
      <button
        type="button"
        aria-label={t('canvas.toolbar.selectAll')}
        onClick={onSelectAll}
        className="group relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <IconSelectAll size={17} stroke={2.1} />
        <ControlTooltip label={t('canvas.toolbar.selectAll')} />
      </button>
      <button
        type="button"
        aria-label={t('canvas.toolbar.arrange')}
        title={t('canvas.toolbar.arrange')}
        onClick={onArrange}
        disabled={!canArrange}
        className="group relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.08] hover:text-white disabled:cursor-not-allowed disabled:opacity-35"
      >
        <IconHierarchy2 size={17} stroke={2.1} />
        <ControlTooltip label={t('canvas.toolbar.arrange')} />
      </button>
      <button
        type="button"
        aria-label={t('canvas.toolbar.grid')}
        className="group relative flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.08] text-white"
      >
        <IconGridDots size={17} stroke={2.1} />
        <ControlTooltip label={t('canvas.toolbar.grid')} />
      </button>
      <button
        type="button"
        aria-label={t('canvas.toolbar.center')}
        onClick={() => reactFlow.setCenter(0, 0, { zoom: 1, duration: 260 })}
        className="group relative flex h-9 w-9 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <IconFocusCentered size={17} stroke={2.1} />
        <ControlTooltip label={t('canvas.toolbar.center')} />
      </button>
      <div className="h-5 w-px bg-white/[0.1]" />
      <button
        type="button"
        aria-label={t('canvas.toolbar.zoomOut')}
        onClick={() => reactFlow.zoomOut({ duration: 180 })}
        className="group relative flex h-8 w-8 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <IconZoomOut size={16} stroke={2.1} />
        <ControlTooltip label={t('canvas.toolbar.zoomOut')} />
      </button>
      <span className="min-w-12 text-center text-[13px] font-semibold text-white/70">{zoom}%</span>
      <button
        type="button"
        aria-label={t('canvas.toolbar.zoomIn')}
        onClick={() => reactFlow.zoomIn({ duration: 180 })}
        className="group relative flex h-8 w-8 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <IconZoomIn size={16} stroke={2.1} />
        <ControlTooltip label={t('canvas.toolbar.zoomIn')} />
      </button>
      {selectedElementCount > 0 ? (
        <>
          <div className="h-5 w-px bg-white/[0.1]" />
          <button
            type="button"
            aria-label={t('canvas.toolbar.deleteSelected')}
            onClick={onDeleteSelected}
            className="group relative flex h-8 w-8 items-center justify-center rounded-xl text-[#ff8b9b] transition-colors hover:bg-[#ff5d73]/16 hover:text-[#ffb3bf]"
          >
            <IconTrash size={16} stroke={2.1} />
            <ControlTooltip label={t('canvas.toolbar.deleteSelected')} />
          </button>
        </>
      ) : null}
    </div>
  );
}

function AssistantDock() {
  return null;
}

void AssistantDock;
