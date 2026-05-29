export type NodeKind = 'text' | 'image' | 'video' | 'audio';

export type NodeStatus = 'idle' | 'queued' | 'running' | 'success' | 'error';

export interface CanvasNodeShape {
  id: string;
  data: {
    kind: NodeKind;
    prompt: string;
    output: string | null;
    status: NodeStatus;
    settings: Record<string, unknown>;
  };
}

export interface CanvasEdgeShape {
  source: string;
  target: string;
}

export interface CanvasConnectionShape {
  source: string | null;
  target: string | null;
}
