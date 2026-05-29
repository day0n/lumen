'use client';

import { LumenMark } from '@/components/ui/LumenMark';
import {
  IconAlertTriangle,
  IconArrowLeft,
  IconBell,
  IconChevronDown,
  IconChevronLeft,
  IconClock,
  IconDots,
  IconFileText,
  IconFocusCentered,
  IconFolder,
  IconFolderFilled,
  IconFolderPlus,
  IconGridDots,
  IconLayoutGrid,
  IconMusic,
  IconPhoto,
  IconPlayerPlay,
  IconPlus,
  IconSearch,
  IconSelectAll,
  IconShare3,
  IconStarFilled,
  IconTrash,
  IconUpload,
  IconUserSquareRounded,
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
  useNodesState,
  useOnViewportChange,
  useReactFlow,
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
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { ChangeEvent, MouseEvent, KeyboardEvent as ReactKeyboardEvent } from 'react';

import { ChatPanel } from '@/features/agent-chat/ChatPanel';
import { useWorkflowWs } from '@/features/workflow/use-workflow-ws';
import type { NodeState } from '@/features/workflow/use-workflow-ws';
import { useLoginRedirect } from '@/lib/auth-redirect';
import { checkCycle } from '@/lib/canvas/cycle-detection';
import { canRunSelectedNodes, canRunSingleNode } from '@/lib/canvas/node-run-check';

type NodeKind = 'text' | 'image' | 'video' | 'audio';

type NodeTemplate = {
  kind: NodeKind;
  title: string;
  icon: typeof IconPlus;
  tone: string;
};

type LumenNodeData = Record<string, unknown> & {
  kind: NodeKind;
  title: string;
  prompt: string;
  output: string | null;
  modelId: string;
  settings: Record<string, unknown>;
  status: 'idle' | 'queued' | 'running' | 'success' | 'error';
  error?: string | null;
  groupId?: string | null;
  groupName?: string | null;
  progress?: number;
};

type LumenNode = Node<LumenNodeData, 'lumenNode'>;
type LumenEdge = Edge<Record<string, unknown>, 'lumenSmooth'>;
type CanvasSaveState = 'idle' | 'loading' | 'saving' | 'saved' | 'error';

interface CanvasActions {
  runSingleNode: (nodeId: string) => void;
  updateNodeData: (nodeId: string, patch: Partial<LumenNodeData>) => void;
  connected: boolean;
  canRunNode: (nodeId: string) => boolean;
}

const CanvasActionsContext = createContext<CanvasActions>({
  runSingleNode: () => {},
  updateNodeData: () => {},
  connected: false,
  canRunNode: () => false,
});

type MaterialFolderId = 'character' | 'scene' | 'item' | 'style' | 'sound' | 'others';

type MaterialFolder = {
  id: MaterialFolderId;
  label: string;
  count: number;
};

type MaterialLibraryItem = {
  id: string;
  folderId: MaterialFolderId;
  title: string;
  meta: string;
  type: 'image' | 'video' | 'audio';
  previewClass: string;
};

interface CanvasWorkbenchProps {
  projectId?: string;
  createOnMount?: boolean;
}

interface CanvasProjectPayload {
  id: string;
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

const defaultModels: Record<NodeKind, { id: string; label: string }[]> = {
  text: [
    { id: 'gemini-3.1-flash-lite', label: 'Gemini 3.1 Flash Lite' },
    { id: 'doubao-seed-2.0-pro', label: '豆包 Seed 2.0' },
  ],
  image: [
    { id: 'nano-banana2', label: 'Nano Banana 2' },
    { id: 'doubao-seedream-3.0', label: 'Seedream 3.0' },
  ],
  video: [
    { id: 'veo-3.1', label: 'Veo 3.1' },
    { id: 'seedance-1.5-pro', label: 'Seedance 1.5' },
  ],
  audio: [
    { id: 'fish-tts', label: 'Fish TTS' },
    { id: 'doubao-tts', label: '豆包 TTS' },
  ],
};

const legacyNodeTitles: Record<NodeKind, string> = {
  text: '文本节点',
  image: '图片节点',
  video: '视频节点',
  audio: '音频节点',
};

const aspectRatioOptions = ['1:1', '4:5', '16:9', '9:16'] as const;

const compatibleTargetKinds: Record<NodeKind, NodeKind[]> = {
  text: ['text', 'image', 'video', 'audio'],
  image: ['text', 'image'],
  video: ['text', 'video'],
  audio: ['text', 'audio'],
};

const materialFolders = [
  { id: 'character', label: '角色', count: 12 },
  { id: 'scene', label: '场景', count: 8 },
  { id: 'item', label: '道具', count: 16 },
  { id: 'style', label: '风格', count: 7 },
  { id: 'sound', label: '音效', count: 21 },
  { id: 'others', label: 'Others', count: 5 },
] satisfies MaterialFolder[];

const materialLibraryItems = [
  {
    id: 'host-shot',
    folderId: 'character',
    title: '直播口播主理人',
    meta: '人物 / 竖屏',
    type: 'image',
    previewClass:
      'bg-[radial-gradient(circle_at_36%_24%,rgba(255,255,255,0.86),transparent_16%),radial-gradient(circle_at_58%_32%,rgba(121,228,255,0.72),transparent_20%),linear-gradient(145deg,#32445f,#111315_72%)]',
  },
  {
    id: 'try-on-model',
    folderId: 'character',
    title: '试穿展示模特',
    meta: '人物 / 半身',
    type: 'image',
    previewClass:
      'bg-[radial-gradient(circle_at_62%_22%,rgba(247,201,106,0.74),transparent_20%),radial-gradient(circle_at_36%_48%,rgba(157,168,255,0.74),transparent_24%),linear-gradient(145deg,#26313d,#101113_76%)]',
  },
  {
    id: 'studio-softbox',
    folderId: 'scene',
    title: '柔光棚拍桌面',
    meta: '场景 / 商品',
    type: 'image',
    previewClass:
      'bg-[radial-gradient(circle_at_44%_34%,rgba(245,247,250,0.76),transparent_22%),linear-gradient(145deg,#38414b,#131619_70%)]',
  },
  {
    id: 'outdoor-cafe',
    folderId: 'scene',
    title: '户外咖啡街角',
    meta: '场景 / 生活方式',
    type: 'video',
    previewClass:
      'bg-[radial-gradient(circle_at_28%_36%,rgba(121,228,255,0.58),transparent_22%),radial-gradient(circle_at_78%_24%,rgba(245,199,106,0.64),transparent_24%),linear-gradient(145deg,#233141,#0e1115_72%)]',
  },
  {
    id: 'gift-box',
    folderId: 'item',
    title: '开箱礼盒彩带',
    meta: '道具 / 节日',
    type: 'image',
    previewClass:
      'bg-[radial-gradient(circle_at_52%_40%,rgba(255,255,255,0.76),transparent_18%),radial-gradient(circle_at_34%_28%,rgba(255,117,146,0.62),transparent_24%),linear-gradient(145deg,#3a2f3d,#111315_72%)]',
  },
  {
    id: 'clean-gradient',
    folderId: 'style',
    title: '清透科技蓝',
    meta: '风格 / 背景',
    type: 'image',
    previewClass:
      'bg-[radial-gradient(circle_at_78%_20%,rgba(121,228,255,0.78),transparent_26%),radial-gradient(circle_at_26%_78%,rgba(157,168,255,0.5),transparent_30%),linear-gradient(145deg,#14212b,#0a0d10_72%)]',
  },
  {
    id: 'notification-pop',
    folderId: 'sound',
    title: '轻快提示音',
    meta: '音效 / 0:03',
    type: 'audio',
    previewClass:
      'bg-[repeating-linear-gradient(90deg,rgba(121,228,255,0.26)_0,rgba(121,228,255,0.26)_4px,transparent_4px,transparent_10px),linear-gradient(145deg,#23303a,#111315_74%)]',
  },
  {
    id: 'brand-bumper',
    folderId: 'others',
    title: '品牌片头贴片',
    meta: '素材 / 0:05',
    type: 'video',
    previewClass:
      'bg-[radial-gradient(circle_at_30%_24%,rgba(245,199,106,0.62),transparent_22%),radial-gradient(circle_at_70%_70%,rgba(121,228,255,0.54),transparent_26%),linear-gradient(145deg,#2b2e34,#101113_74%)]',
  },
] satisfies MaterialLibraryItem[];

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

function getAspectRatio(settings: Record<string, unknown>) {
  const value = getSettingString(settings, 'aspectRatio');
  return aspectRatioOptions.includes(value as (typeof aspectRatioOptions)[number]) ? value : '16:9';
}

function getNodeTitle(data: LumenNodeData) {
  const template = getTemplate(data.kind);
  if (!data.title || data.title === legacyNodeTitles[data.kind]) {
    return template.title;
  }

  return data.title;
}

function canConnectNodeKinds(sourceKind: NodeKind, targetKind: NodeKind) {
  return compatibleTargetKinds[sourceKind].includes(targetKind);
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        resolve(reader.result);
        return;
      }

      reject(new Error('文件读取失败'));
    };
    reader.onerror = () => reject(reader.error ?? new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function toWorkflowNodes(nodes: LumenNode[]) {
  return nodes.map((node) => {
    const inputImage = getSettingString(node.data.settings, 'inputImage');
    const inputVideo = getSettingString(node.data.settings, 'inputVideo');

    return {
      id: node.id,
      type: node.data.kind,
      position: node.position,
      output: node.data.output?.trim() ? node.data.output : null,
      input: {
        prompt: node.data.prompt,
        image: inputImage || null,
        video: inputVideo || null,
      },
      model: { id: resolveModelId(node.data), settings: node.data.settings },
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

export function CanvasWorkbench({ projectId, createOnMount = false }: CanvasWorkbenchProps) {
  return (
    <ReactFlowProvider>
      <CanvasWorkbenchInner createOnMount={createOnMount} projectId={projectId} />
    </ReactFlowProvider>
  );
}

function CanvasWorkbenchInner({ projectId, createOnMount }: CanvasWorkbenchProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { isLoaded: authReady, isSignedIn, requireLogin } = useLoginRedirect();
  const initialPrompt = useMemo(() => searchParams?.get('prompt') ?? null, [searchParams]);
  const shouldOpenAgentChat = searchParams?.get('agent') === 'chat';
  const [activeKind, setActiveKind] = useState<NodeKind>('text');
  const [nodeMenuOpen, setNodeMenuOpen] = useState(false);
  const [materialPanelOpen, setMaterialPanelOpen] = useState(false);
  const [currentProjectId, setCurrentProjectId] = useState(projectId ?? null);
  const [projectTitle, setProjectTitle] = useState('未命名画布');
  const [saveState, setSaveState] = useState<CanvasSaveState>(projectId ? 'loading' : 'idle');
  const [nodes, setNodes, onNodesChange] = useNodesState<LumenNode>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<LumenEdge>([]);
  const reactFlow = useReactFlow<LumenNode, LumenEdge>();
  const hasRequestedCreate = useRef(false);
  const hasHydratedProject = useRef(!projectId && !createOnMount);
  const lastSavedCanvas = useRef('');
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
        name: groupNodes[0]?.data.groupName || '新建组',
        nodes: groupNodes,
        bounds: getNodeBounds(groupNodes, 20),
        selected: groupNodes.some((node) => node.selected),
        canRun: canRunSelectedNodes({
          selectedIds: groupNodes.map((node) => node.id),
          nodes,
          edges,
        }),
      }))
      .filter((group) => group.bounds);
  }, [edges, nodes]);
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

  const { connected, runNodes } = useWorkflowWs({
    url: wsUrl,
    onNodeStateChange: handleNodeStateChange,
  });

  const runSingleNode = useCallback(
    (nodeId: string) => {
      runNodes([nodeId], toWorkflowNodes(nodes), toWorkflowEdges(edges));
    },
    [nodes, edges, runNodes],
  );

  const runGroup = useCallback(
    (groupId: string) => {
      const nodeIds = getGroupedNodeIds(nodes, groupId);
      if (nodeIds.length === 0) return;
      runNodes(nodeIds, toWorkflowNodes(nodes), toWorkflowEdges(edges));
    },
    [nodes, edges, runNodes],
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
            groupName: '新建组',
          },
        };
      }),
    );
  }, [selectedNodes.length, setNodes]);

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

  useEffect(() => {
    if (!authReady || isSignedIn) return;
    requireLogin();
  }, [authReady, isSignedIn, requireLogin]);

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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: projectTitle,
            canvas,
          }),
          signal: controller.signal,
        });
        const project = await readProjectResponse(response);
        setCurrentProjectId(project.id);
        setProjectTitle(project.title);
        setNodes(withCanvasNodeLayering(project.canvas.nodes));
        setEdges(withCanvasEdgeLayering(project.canvas.edges));
        lastSavedCanvas.current = JSON.stringify(project.canvas);
        hasHydratedProject.current = true;
        setSaveState('saved');
        const queryParams = new URLSearchParams();
        if (initialPrompt) queryParams.set('prompt', initialPrompt);
        if (shouldOpenAgentChat) queryParams.set('agent', 'chat');
        const query = queryParams.toString();
        router.replace(`/canvas/${project.id}${query ? `?${query}` : ''}`);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }
        console.error(error);
        setSaveState('error');
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
    initialPrompt,
    nodes,
    projectTitle,
    router,
    setEdges,
    setNodes,
    shouldOpenAgentChat,
    isSignedIn,
  ]);

  useEffect(() => {
    if (!currentProjectId || !authReady || !isSignedIn) {
      return;
    }

    const controller = new AbortController();
    hasHydratedProject.current = false;
    setSaveState('loading');

    async function loadProject() {
      try {
        const response = await fetch(`/api/projects/${currentProjectId}`, {
          signal: controller.signal,
        });
        const project = await readProjectResponse(response);
        setProjectTitle(project.title);
        setNodes(withCanvasNodeLayering(project.canvas.nodes));
        setEdges(withCanvasEdgeLayering(project.canvas.edges));
        lastSavedCanvas.current = JSON.stringify(project.canvas);
        hasHydratedProject.current = true;
        setSaveState('saved');
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(error);
          setSaveState('error');
        }
      }
    }

    void loadProject();
    return () => controller.abort();
  }, [authReady, currentProjectId, isSignedIn, setEdges, setNodes]);

  useEffect(() => {
    if (!currentProjectId || !hasHydratedProject.current || !authReady || !isSignedIn) {
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
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ canvas }),
          signal: controller.signal,
        });
        const project = await readProjectResponse(response);
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
  }, [authReady, currentProjectId, edges, isSignedIn, nodes]);

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
      }
      return nextOpen;
    });
  }, []);

  const toggleMaterialPanel = useCallback(() => {
    setMaterialPanelOpen((open) => {
      const nextOpen = !open;
      if (nextOpen) {
        setNodeMenuOpen(false);
      }
      return nextOpen;
    });
  }, []);

  return (
    <main className="relative h-screen overflow-hidden bg-[#050607] text-white">
      <CanvasGrid />
      <CanvasActionsContext.Provider
        value={{ runSingleNode, updateNodeData, connected, canRunNode }}
      >
        <div className="absolute inset-0 z-10">
          <ReactFlow
            className="lumen-flow"
            nodes={nodes}
            edges={edges}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onReconnect={onReconnect}
            isValidConnection={isValidConnection}
            edgesFocusable
            edgesReconnectable
            reconnectRadius={14}
            onPaneClick={onPaneClick}
            connectionLineComponent={LumenConnectionLine}
            connectionRadius={42}
            deleteKeyCode={['Backspace', 'Delete']}
            disableKeyboardA11y={false}
            elementsSelectable
            elevateEdgesOnSelect={false}
            elevateNodesOnSelect
            multiSelectionKeyCode={['Meta', 'Control']}
            panActivationKeyCode="Space"
            panOnDrag={[1]}
            selectionKeyCode="Shift"
            selectionMode={SelectionMode.Partial}
            selectionOnDrag
            selectNodesOnDrag={false}
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
            panOnScroll
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
                    canRun={connected && group.canRun}
                    name={group.name}
                    onRun={() => runGroup(group.id)}
                    onUngroup={() => ungroupNodes(group.id)}
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

        <CanvasTopbar saveState={saveState} title={projectTitle} />
        {materialPanelOpen ? null : (
          <LeftToolbar
            activeKind={activeKind}
            materialPanelOpen={materialPanelOpen}
            menuOpen={nodeMenuOpen}
            onPickTemplate={onPickTemplate}
            onToggleMaterialPanel={toggleMaterialPanel}
            onToggleMenu={toggleNodeMenu}
          />
        )}
        {materialPanelOpen ? (
          <MaterialLibraryPanel onClose={() => setMaterialPanelOpen(false)} />
        ) : null}
        <BottomControls
          onDeleteSelected={deleteSelectedElements}
          onSelectAll={selectAllElements}
          selectedElementCount={selectedElementCount}
        />
        <ChatPanel
          sessionId={currentProjectId ?? undefined}
          initialPrompt={currentProjectId ? initialPrompt : null}
          defaultOpen={shouldOpenAgentChat}
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
    </main>
  );
}

function serializeCanvas(nodes: LumenNode[], edges: LumenEdge[]) {
  return {
    nodes: nodes.map((node) => ({
      ...node,
      dragging: undefined,
      selected: undefined,
      zIndex: undefined,
    })),
    edges: edges.map((edge) => ({
      ...edge,
      selected: undefined,
      zIndex: undefined,
    })),
  };
}

async function readProjectResponse(response: Response): Promise<CanvasProjectPayload> {
  const payload = (await response.json()) as ProjectApiResponse;

  if (!response.ok || !payload.ok) {
    throw new Error(payload.ok ? '项目请求失败' : payload.error.message);
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
  onUngroup,
  selected,
}: {
  bounds: FlowBounds;
  canRun: boolean;
  name: string;
  onRun: () => void;
  onUngroup: () => void;
  selected: boolean;
}) {
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
          selected ? 'border-white/42' : 'border-white/[0.16]'
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
          aria-label="整组执行"
          disabled={!canRun}
          onClick={onRun}
          className="flex h-8 items-center gap-1.5 rounded-[13px] px-2.5 text-[12px] font-black text-white/72 transition-colors hover:bg-white/[0.08] hover:text-white disabled:opacity-30"
        >
          <IconPlayerPlay size={14} stroke={2.4} />
          整组执行
        </button>
        <button
          type="button"
          aria-label="解组"
          onClick={onUngroup}
          className="flex h-8 items-center gap-1.5 rounded-[13px] px-2.5 text-[12px] font-black text-white/72 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <IconGridDots size={14} stroke={2.4} />
          解组
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
        已选 {selectedCount}
      </span>
      <button
        type="button"
        aria-label="打组"
        onClick={onGroup}
        className="flex h-8 items-center gap-1.5 rounded-[13px] px-2.5 text-[12px] font-black text-white/72 transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <IconLayoutGrid size={14} stroke={2.4} />
        打组
      </button>
    </div>
  );
}

function CanvasTopbar({ saveState, title }: { saveState: CanvasSaveState; title: string }) {
  const saveLabel = getSaveLabel(saveState);

  return (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex h-20 items-center justify-between px-5">
      <div className="pointer-events-auto flex items-center gap-3">
        <Link
          href="/canvas/projects"
          aria-label="返回工作室"
          className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.07] text-white/70 ring-1 ring-white/[0.09] transition-colors hover:bg-white/[0.12] hover:text-white"
        >
          <IconArrowLeft size={18} stroke={2.2} />
        </Link>
        <LumenMark size={32} />
        <div>
          <div className="flex items-center gap-2">
            <h1 className="font-display text-[16px] font-bold leading-none text-white">{title}</h1>
            <span
              className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${
                saveState === 'error'
                  ? 'bg-[#ff5d73]/15 text-[#ff9daa] ring-[#ff5d73]/18'
                  : 'bg-white/[0.07] text-white/52 ring-white/[0.08]'
              }`}
            >
              {saveLabel}
            </span>
          </div>
          <p className="mt-1 text-[12px] text-white/42">Lumen 工作室 / 商品短视频项目</p>
        </div>
      </div>

      <div className="pointer-events-auto flex items-center gap-2">
        <button
          type="button"
          aria-label="通知"
          className="flex h-10 w-10 items-center justify-center rounded-2xl bg-white/[0.07] text-white/66 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.12] hover:text-white"
        >
          <IconBell size={17} stroke={2.1} />
        </button>
        <button
          type="button"
          className="flex h-10 items-center gap-2 rounded-2xl bg-white px-4 text-[13px] font-bold text-[#111315] shadow-[0_16px_40px_rgba(0,0,0,0.28)] transition-transform hover:scale-[1.02]"
        >
          <IconShare3 size={16} stroke={2.3} />
          分享项目
        </button>
      </div>
    </header>
  );
}

function getSaveLabel(saveState: CanvasSaveState) {
  switch (saveState) {
    case 'loading':
      return '读取中';
    case 'saving':
      return '保存中';
    case 'error':
      return '保存失败';
    case 'idle':
    case 'saved':
      return '自动保存';
  }
}

function LeftToolbar({
  activeKind,
  materialPanelOpen,
  menuOpen,
  onPickTemplate,
  onToggleMaterialPanel,
  onToggleMenu,
}: {
  activeKind: NodeKind;
  materialPanelOpen: boolean;
  menuOpen: boolean;
  onPickTemplate: (template: NodeTemplate) => void;
  onToggleMaterialPanel: () => void;
  onToggleMenu: () => void;
}) {
  return (
    <aside className="absolute left-5 top-24 z-40 flex items-start">
      <div className="flex h-[430px] w-[64px] flex-col items-center rounded-[28px] bg-[#151719]/90 p-2 shadow-[0_22px_70px_rgba(0,0,0,0.42)] ring-1 ring-white/[0.08] backdrop-blur-xl">
        <button
          type="button"
          aria-expanded={menuOpen}
          aria-label="添加节点"
          title="添加节点"
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
            ariaLabel="素材库"
            icon={IconFolder}
            label="素材库"
            onClick={onToggleMaterialPanel}
          />
          <ToolbarButton ariaLabel="历史版本" icon={IconClock} label="历史" />
        </div>

        <div className="mt-auto h-px w-8 bg-white/[0.1]" />
        <div className="mt-4 mb-1 flex h-10 w-10 items-center justify-center overflow-hidden rounded-full bg-[#24272b] ring-2 ring-white/[0.12]">
          <LumenMark size={28} />
        </div>
      </div>
      {menuOpen ? <NodeAddMenu activeKind={activeKind} onPickTemplate={onPickTemplate} /> : null}
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

function MaterialLibraryPanel({ onClose }: { onClose: () => void }) {
  const [activeFolder, setActiveFolder] = useState<MaterialFolderId>('character');
  const [createMenuOpen, setCreateMenuOpen] = useState(false);
  const visibleItems = materialLibraryItems.filter((item) => item.folderId === activeFolder);
  const activeFolderLabel =
    materialFolders.find((folder) => folder.id === activeFolder)?.label ?? '素材';

  return (
    <section className="absolute left-5 top-[92px] bottom-24 z-30 flex w-[calc(100vw-40px)] max-w-[340px] flex-col overflow-hidden rounded-[24px] bg-[#111315]/94 text-white shadow-[0_28px_90px_rgba(0,0,0,0.5)] ring-1 ring-white/[0.09] backdrop-blur-2xl sm:w-[340px]">
      <div className="flex items-center gap-2 px-4 pt-4">
        <button
          type="button"
          aria-label="收起素材库"
          onClick={onClose}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white/52 transition-colors hover:bg-white/[0.08] hover:text-white"
        >
          <IconChevronLeft size={19} stroke={2.2} />
        </button>
        <h2 className="min-w-0 flex-1 truncate font-display text-[24px] font-black tracking-tight text-white">
          素材库
        </h2>
        <button
          type="button"
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-white/[0.1] px-3 text-[13px] font-bold text-white/86 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.15]"
        >
          <IconUserSquareRounded size={17} stroke={2.1} />
          AI 角色
        </button>
        <div className="relative">
          <button
            type="button"
            aria-expanded={createMenuOpen}
            aria-label="新建素材"
            onClick={() => setCreateMenuOpen((open) => !open)}
            className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.1] text-white/84 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.15] hover:text-white"
          >
            <IconPlus size={20} stroke={2.3} />
          </button>
          {createMenuOpen ? (
            <div className="absolute right-0 top-11 z-40 w-[220px] rounded-[22px] bg-[#2a2b2d]/98 p-2 shadow-[0_24px_70px_rgba(0,0,0,0.48)] ring-1 ring-white/[0.1] backdrop-blur-2xl">
              <button
                type="button"
                onClick={() => setCreateMenuOpen(false)}
                className="flex w-full items-center gap-3 rounded-[15px] px-3 py-3 text-left text-[14px] font-bold text-white/88 transition-colors hover:bg-white/[0.08]"
              >
                <IconUpload size={19} stroke={2.2} />
                上传
              </button>
              <button
                type="button"
                onClick={() => setCreateMenuOpen(false)}
                className="flex w-full items-center gap-3 rounded-[15px] px-3 py-3 text-left text-[14px] font-bold text-white/88 transition-colors hover:bg-white/[0.08]"
              >
                <IconFolderPlus size={19} stroke={2.2} />
                新建文件夹
              </button>
            </div>
          ) : null}
        </div>
      </div>

      <div className="px-4 pt-4">
        <label className="flex h-10 items-center gap-2 rounded-2xl bg-black/20 px-3 text-white/42 ring-1 ring-white/[0.08]">
          <IconSearch size={18} stroke={2.1} />
          <input
            className="min-w-0 flex-1 bg-transparent text-[13px] font-medium text-white outline-none placeholder:text-white/36"
            placeholder="搜索"
          />
        </label>
      </div>

      <div className="mt-3 flex-1 overflow-y-auto px-4 pb-4">
        <button
          type="button"
          className="flex h-12 w-full items-center gap-3 rounded-2xl px-2 text-left text-[14px] font-bold text-white/74 transition-colors hover:bg-white/[0.06] hover:text-white"
        >
          <IconStarFilled size={20} className="text-white/72" />
          收藏
        </button>

        <div className="my-3 h-px bg-white/[0.08]" />

        <div className="mb-2 px-2 text-[12px] font-bold text-white/36">文件夹</div>
        <div className="space-y-1">
          {materialFolders.map((folder) => {
            const active = folder.id === activeFolder;

            return (
              <button
                key={folder.id}
                type="button"
                onClick={() => setActiveFolder(folder.id)}
                className={`group flex h-12 w-full items-center gap-2 rounded-2xl px-2 text-left transition-colors ${
                  active ? 'bg-white/[0.1]' : 'hover:bg-white/[0.06]'
                }`}
              >
                <IconChevronDown
                  size={16}
                  className={`shrink-0 text-white/42 transition-transform ${
                    active ? 'rotate-0' : '-rotate-90'
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
                  {folder.label}
                </span>
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[11px] font-semibold text-white/36">
                  {folder.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="mt-5 flex items-center justify-between px-2">
          <div className="text-[12px] font-bold text-white/36">{activeFolderLabel}</div>
          <button
            type="button"
            aria-label="更多"
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white/36 transition-colors hover:bg-white/[0.07] hover:text-white"
          >
            <IconDots size={18} stroke={2.2} />
          </button>
        </div>

        <div className="mt-2 space-y-2">
          {visibleItems.map((item) => (
            <button
              key={item.id}
              type="button"
              className="flex w-full items-center gap-3 rounded-2xl bg-white/[0.045] p-2 text-left ring-1 ring-white/[0.055] transition-colors hover:bg-white/[0.08]"
            >
              <span
                className={`h-12 w-12 shrink-0 overflow-hidden rounded-xl ${item.previewClass}`}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-bold text-white/84">
                  {item.title}
                </span>
                <span className="mt-1 block truncate text-[11px] font-medium text-white/38">
                  {item.meta}
                </span>
              </span>
              <span className="rounded-full bg-black/20 px-2 py-0.5 text-[10px] font-bold uppercase text-white/32">
                {item.type}
              </span>
            </button>
          ))}
        </div>
      </div>
    </section>
  );
}

function NodeAddMenu({
  activeKind,
  onPickTemplate,
}: {
  activeKind: NodeKind;
  onPickTemplate: (template: NodeTemplate) => void;
}) {
  return (
    <div className="ml-3 w-[248px] rounded-[22px] bg-[#202123]/94 p-2.5 shadow-[0_24px_80px_rgba(0,0,0,0.46)] ring-1 ring-white/[0.08] backdrop-blur-2xl">
      <div className="px-2 pb-2 pt-1 text-[12px] font-semibold text-white/48">添加节点</div>
      <div className="space-y-1">
        {nodeCatalog.map((template) => {
          const Icon = template.icon;
          const active = template.kind === activeKind;

          return (
            <button
              key={template.kind}
              type="button"
              className={`flex w-full items-center gap-2.5 rounded-[14px] px-2 py-2 text-left transition-colors ${
                active ? 'bg-white/[0.12]' : 'hover:bg-white/[0.08]'
              }`}
              onClick={() => onPickTemplate(template)}
            >
              <span
                className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br ${template.tone} text-white ring-1 ring-white/[0.1]`}
              >
                <Icon size={18} stroke={2.2} />
              </span>
              <span className="min-w-0">
                <span className="block text-[13px] font-bold text-white/88">{template.title}</span>
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
          {isFromSource ? '连接到' : '从此处来源'}
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
              <span className="text-[13px] font-bold text-white/86">{template.title}</span>
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

function LumenFlowNode({ data, id, selected }: NodeProps<LumenNode>) {
  const { setNodes: setFlowNodes } = useReactFlow<LumenNode, LumenEdge>();
  const { runSingleNode, updateNodeData, connected, canRunNode } = useContext(CanvasActionsContext);
  const styles = nodeKindStyles[data.kind];
  const status = data.status ?? 'idle';
  const modelId = resolveModelId(data);
  const progress = data.progress ?? (status === 'running' ? 0.45 : 0);
  const canRun = connected && canRunNode(id);
  const nodeTitle = getNodeTitle(data);
  const inputImage = getSettingString(data.settings, 'inputImage');
  const aspectRatio = getAspectRatio(data.settings);
  const acceptsImageInput = data.kind === 'image' || data.kind === 'video';

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
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      const dataUrl = await readFileAsDataUrl(file);
      updateSettings({ inputImage: dataUrl });
    },
    [updateSettings],
  );

  const handleRun = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!canRun) return;
      if (!data.modelId) updateNodeData(id, { modelId });
      runSingleNode(id);
    },
    [canRun, data.modelId, id, modelId, runSingleNode, updateNodeData],
  );

  const handlePromptKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Escape') {
        event.currentTarget.blur();
        return;
      }

      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        if (!canRun) return;
        runSingleNode(id);
      }
    },
    [canRun, id, runSingleNode],
  );

  return (
    <div
      className={`group relative ${styles.shell} text-white`}
      onMouseDownCapture={handleNodePointerDownCapture}
      onPointerDownCapture={handleNodePointerDownCapture}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!left-[-7px] !z-[70] !h-3 !w-3 !cursor-crosshair !rounded-full !border-[2px] !border-white/72 !bg-[#202123] !shadow-none hover:!scale-[1.35] !transition-transform"
      />

      <div
        className={`relative overflow-hidden rounded-[13px] bg-[#202123]/96 ring-1 backdrop-blur-xl transition-all duration-200 ${
          selected ? `ring-white/28 ${styles.glow}` : 'ring-white/[0.1] hover:ring-white/[0.16]'
        }`}
      >
        <div className="border-b border-white/[0.06] p-2.5">
          <input
            aria-label="节点标题"
            className="nodrag nopan mb-2 h-6 w-full bg-transparent px-1 text-[12px] font-bold text-white/78 outline-none placeholder:text-white/24"
            onChange={(event) => updateNodeData(id, { title: event.target.value })}
            value={nodeTitle}
          />
          <div className={`relative overflow-hidden rounded-[10px] ${styles.preview}`}>
            <NodeOutputEditor
              data={data}
              onChange={(output) => updateNodeData(id, { output: output || null })}
            />
            {status === 'running' || status === 'queued' ? (
              <div className="absolute inset-x-0 bottom-0 h-1 bg-white/[0.06]">
                <div
                  className="h-full rounded-r-full bg-white/70 transition-all duration-300"
                  style={{ width: `${Math.max(8, Math.round(progress * 100))}%` }}
                />
              </div>
            ) : null}
          </div>
        </div>

        {selected ? (
          <div className="bg-[#242527]/95 p-2.5">
            {acceptsImageInput ? (
              <div className="mb-2 grid grid-cols-[auto_1fr] gap-2">
                <label className="nodrag group/upload relative flex h-[58px] w-[74px] cursor-pointer items-center justify-center overflow-hidden rounded-[10px] bg-[#2d2e30]/86 text-white/42 ring-1 ring-white/[0.07] transition-colors hover:bg-white/[0.08] hover:text-white/74">
                  {inputImage ? (
                    <img
                      alt="输入图片"
                      className="absolute inset-0 h-full w-full object-cover opacity-75 transition-opacity group-hover/upload:opacity-55"
                      src={inputImage}
                    />
                  ) : (
                    <IconUpload size={18} stroke={2.2} />
                  )}
                  <span className="absolute inset-x-0 bottom-0 bg-black/42 py-1 text-center text-[10px] font-black text-white/70 opacity-0 transition-opacity group-hover/upload:opacity-100">
                    上传
                  </span>
                  <input
                    className="sr-only"
                    type="file"
                    accept="image/*"
                    onChange={handleAssetUpload}
                  />
                </label>
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
                      清除
                    </button>
                  ) : null}
                </div>
              </div>
            ) : null}
            <div className="rounded-[10px] bg-[#2d2e30]/86 p-3 ring-1 ring-white/[0.07]">
              <textarea
                aria-label="输入"
                onChange={(event) => updateNodeData(id, { prompt: event.target.value })}
                onKeyDown={handlePromptKeyDown}
                className="nodrag nowheel block min-h-[112px] w-full resize-none bg-transparent text-[13px] leading-relaxed text-white/78 outline-none placeholder:text-white/32"
                placeholder={styles.promptPlaceholder}
                value={data.prompt}
              />
            </div>

            <div className="mt-2 flex items-center gap-2">
              <select
                aria-label="选择模型"
                className="nodrag h-9 min-w-0 flex-1 cursor-pointer rounded-[13px] bg-white/[0.065] px-2.5 text-[12px] font-bold text-white/72 outline-none ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.1]"
                onChange={(event) => updateNodeData(id, { modelId: event.target.value })}
                value={modelId}
              >
                {defaultModels[data.kind].map((model) => (
                  <option key={model.id} value={model.id}>
                    {model.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                aria-label="运行节点"
                title="运行节点"
                disabled={!canRun}
                className={`nodrag flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[12px] font-black shadow-[0_12px_28px_rgba(0,0,0,0.22)] transition-colors disabled:opacity-30 ${styles.primaryButton}`}
                onClick={handleRun}
              >
                <IconPlayerPlay size={15} stroke={2.5} />
              </button>
            </div>

            {status === 'error' && data.error ? (
              <div className="mt-2 rounded-[12px] bg-[#ff5d73]/10 px-3 py-2 text-[12px] font-semibold text-[#ffabb6] ring-1 ring-[#ff5d73]/16">
                {data.error}
              </div>
            ) : null}

            {!connected ? (
              <div className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-white/30">
                <IconAlertTriangle size={13} stroke={2.2} />
                工作流引擎未连接
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
}: {
  data: LumenNodeData;
  onChange: (output: string) => void;
}) {
  const output = data.output ?? '';
  const trimmedOutput = output.trim();

  if (
    trimmedOutput &&
    data.kind === 'image' &&
    (trimmedOutput.startsWith('data:image') || trimmedOutput.startsWith('http'))
  ) {
    return (
      <img
        alt="图片"
        className="h-full w-full object-cover"
        onError={(event) => {
          event.currentTarget.style.opacity = '0';
        }}
        src={trimmedOutput}
      />
    );
  }

  if (trimmedOutput.startsWith('data:audio')) {
    return (
      <div className="flex h-[86px] items-center gap-1.5">
        {waveformBars.map((bar) => (
          <span
            key={bar.id}
            className="w-1.5 rounded-full bg-white/28"
            style={{ height: bar.height }}
          />
        ))}
      </div>
    );
  }

  return (
    <textarea
      aria-label="输出"
      className="nodrag nowheel block min-h-[104px] w-full resize-none bg-transparent px-3 py-2.5 text-[13px] leading-relaxed text-white/78 outline-none placeholder:text-white/26"
      onChange={(event) => onChange(event.target.value)}
      placeholder="双击开始编辑..."
      value={output}
    />
  );
}

function LumenSmoothEdge(props: EdgeProps<LumenEdge>) {
  const { id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, selected } =
    props;
  const [isHovered, setIsHovered] = useState(false);
  const { deleteElements } = useReactFlow<LumenNode, LumenEdge>();
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
        height={28}
        style={{ overflow: 'visible', pointerEvents: 'all' }}
        width={28}
        x={labelX - 14}
        y={labelY - 14}
      >
        <button
          type="button"
          aria-label="删除连线"
          className={`nodrag nopan flex h-7 w-7 items-center justify-center rounded-full bg-[#ff5d73] text-white shadow-[0_10px_24px_rgba(255,93,115,0.28)] transition-opacity hover:opacity-100 ${
            selected || isHovered ? 'opacity-100' : 'opacity-55'
          }`}
          onClick={handleDelete}
        >
          <IconTrash size={14} stroke={2.2} />
        </button>
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

function BottomControls({
  onDeleteSelected,
  onSelectAll,
  selectedElementCount,
}: {
  onDeleteSelected: () => void;
  onSelectAll: () => void;
  selectedElementCount: number;
}) {
  const reactFlow = useReactFlow<LumenNode, LumenEdge>();
  const [zoom, setZoom] = useState(100);

  useOnViewportChange({
    onChange: ({ zoom: nextZoom }) => setZoom(Math.round(nextZoom * 100)),
  });

  return (
    <div className="absolute bottom-5 left-5 z-30 flex items-center gap-2 rounded-2xl bg-[#17191c]/88 p-2 text-white/64 shadow-[0_16px_48px_rgba(0,0,0,0.4)] ring-1 ring-white/[0.08] backdrop-blur-xl">
      <button
        type="button"
        aria-label="适配全部节点"
        onClick={() => reactFlow.fitView({ padding: 0.28, duration: 260 })}
        className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <IconLayoutGrid size={17} stroke={2.1} />
      </button>
      <button
        type="button"
        aria-label="全选"
        onClick={onSelectAll}
        className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <IconSelectAll size={17} stroke={2.1} />
      </button>
      <button
        type="button"
        aria-label="网格"
        className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.08] text-white"
      >
        <IconGridDots size={17} stroke={2.1} />
      </button>
      <button
        type="button"
        aria-label="居中画布"
        onClick={() => reactFlow.setCenter(0, 0, { zoom: 1, duration: 260 })}
        className="flex h-9 w-9 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <IconFocusCentered size={17} stroke={2.1} />
      </button>
      <div className="h-5 w-px bg-white/[0.1]" />
      <button
        type="button"
        aria-label="缩小"
        onClick={() => reactFlow.zoomOut({ duration: 180 })}
        className="flex h-8 w-8 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <IconZoomOut size={16} stroke={2.1} />
      </button>
      <span className="min-w-12 text-center text-[13px] font-semibold text-white/70">{zoom}%</span>
      <button
        type="button"
        aria-label="放大"
        onClick={() => reactFlow.zoomIn({ duration: 180 })}
        className="flex h-8 w-8 items-center justify-center rounded-xl transition-colors hover:bg-white/[0.08] hover:text-white"
      >
        <IconZoomIn size={16} stroke={2.1} />
      </button>
      {selectedElementCount > 0 ? (
        <>
          <div className="h-5 w-px bg-white/[0.1]" />
          <button
            type="button"
            aria-label="删除选中元素"
            onClick={onDeleteSelected}
            className="flex h-8 w-8 items-center justify-center rounded-xl text-[#ff8b9b] transition-colors hover:bg-[#ff5d73]/16 hover:text-[#ffb3bf]"
          >
            <IconTrash size={16} stroke={2.1} />
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
