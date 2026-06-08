'use client';

import { createContext } from 'react';

import type { NodeKind } from '@/lib/canvas/types';

type MaterialAssetKind = 'image' | 'video' | 'audio';

export interface CanvasActions {
  runSingleNode: (nodeId: string) => void;
  cancelNodes: (nodeIds: string[]) => void;
  updateNodeData: (nodeId: string, patch: Record<string, unknown>) => void;
  uploadCanvasMedia: (file: File, kind: MaterialAssetKind, nodeId?: string) => Promise<string>;
  connectionError: string | null;
  canRunNode: (nodeId: string) => boolean;
  openCompositionEditor: (nodeId: string) => void;
}

export const CanvasActionsContext = createContext<CanvasActions>({
  runSingleNode: () => {},
  cancelNodes: () => {},
  updateNodeData: () => {},
  uploadCanvasMedia: async () => '',
  connectionError: null,
  canRunNode: () => false,
  openCompositionEditor: () => {},
});

export type { MaterialAssetKind };
