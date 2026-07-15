export type NodeKind = 'text' | 'image' | 'video' | 'audio' | 'composition';

export type NodeStatus = 'idle' | 'queued' | 'running' | 'success' | 'error' | 'cancelled';

export interface CanvasNodeShape {
  id: string;
  data: {
    kind: NodeKind;
    title?: string;
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
