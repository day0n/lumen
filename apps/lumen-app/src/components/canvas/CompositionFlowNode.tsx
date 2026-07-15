'use client';

import { parseCompositionTimeline } from '@lumen/shared/domain';
import type { PublicErrorFields } from '@lumen/shared/domain';
import {
  IconLoader2,
  IconPlayerPlay,
  IconPlayerStop,
  IconScissors,
  IconUpload,
} from '@tabler/icons-react';
import { Handle, Position, useReactFlow } from '@xyflow/react';
import {
  type ChangeEvent,
  type MouseEvent,
  memo,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
} from 'react';

import { NodeLodOverlay } from '@/components/canvas/NodeLodOverlay';
import { CanvasLodContext } from '@/components/canvas/canvas-lod-context';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { getTimelineDuration } from '@/features/video-composition/resolvePlayheadClip';
import { useI18n } from '@/i18n/provider';
import type { NodeKind, NodeStatus } from '@/lib/canvas/types';
import { formatPublicWorkflowError } from '@/lib/public-workflow-error';

import { CanvasActionsContext } from './canvas-actions-context';

type CompositionNodeData = PublicErrorFields & {
  kind: 'composition';
  title: string;
  prompt: string;
  output: string | null;
  modelId: string;
  settings: Record<string, unknown>;
  status: NodeStatus;
  error?: string | null;
  progress?: number;
  upstreamOutputCount?: number;
};

function isWorkflowNodeBusy(status?: NodeStatus) {
  return status === 'queued' || status === 'running';
}

function toCompositionAspectRatio(aspectRatio: string | undefined) {
  if (aspectRatio === '16:9') return '16 / 9';
  if (aspectRatio === '1:1') return '1 / 1';
  if (aspectRatio === '4:5') return '4 / 5';
  return '9 / 16';
}

export function CompositionFlowNode(props: {
  data: CompositionNodeData;
  id: string;
  selected?: boolean;
}) {
  return <CompositionFlowNodeMemo {...props} />;
}

// Memoize the heavy composition body so unrelated progress events do not
// rebuild its clip strip, scrubber, and drawer state.
const CompositionFlowNodeMemo = memo(CompositionFlowNodeImpl);

function CompositionFlowNodeImpl({
  data,
  id,
  selected,
}: {
  data: CompositionNodeData;
  id: string;
  selected?: boolean;
}) {
  const { t } = useI18n();
  const lowDetail = useContext(CanvasLodContext);
  const { setNodes: setFlowNodes } = useReactFlow();
  const [cancelConfirmOpen, setCancelConfirmOpen] = useState(false);
  const {
    runSingleNode,
    cancelNodes,
    updateNodeData,
    uploadCanvasMedia,
    canRunNode,
    openCompositionEditor,
  } = useContext(CanvasActionsContext);
  const uploadInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const status = data.status ?? 'idle';
  const progress = data.progress ?? (status === 'running' ? 0.45 : 0);
  const canRun = canRunNode(id);
  const isNodeBusy = isWorkflowNodeBusy(status);
  const progressPercent = Math.max(isNodeBusy ? 14 : 0, Math.round(progress * 100));
  const nodeError = formatPublicWorkflowError(data, t, data.error);
  const upstreamOutputCount =
    typeof data.upstreamOutputCount === 'number' ? data.upstreamOutputCount : 0;

  const timeline = parseCompositionTimeline(data.settings ?? {});
  const clipCount = timeline?.clips.length ?? 0;
  const totalDuration = useMemo(
    () => (timeline?.clips ? getTimelineDuration(timeline.clips) : 0),
    [timeline?.clips],
  );
  const previewAspectRatio = toCompositionAspectRatio(timeline?.aspectRatio);

  const nodeTitle =
    data.title && data.title !== t('canvas.nodeKinds.composition')
      ? data.title
      : t('canvas.nodeKinds.composition');

  const selectSelf = useCallback(() => {
    setFlowNodes((currentNodes) =>
      currentNodes.map((node) => ({ ...node, selected: node.id === id })),
    );
  }, [id, setFlowNodes]);

  const handleRun = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!canRun || isNodeBusy) return;
      runSingleNode(id);
    },
    [canRun, id, isNodeBusy, runSingleNode],
  );

  const handleOpenEditor = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      openCompositionEditor(id);
    },
    [id, openCompositionEditor],
  );

  const handleUploadCompositionVideo = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = '';
      if (!file) return;

      const previousValue = data.output ?? null;
      const previewUrl = URL.createObjectURL(file);
      setUploading(true);
      updateNodeData(id, { output: previewUrl });
      try {
        const uploadedUrl = await uploadCanvasMedia(file, 'video', id);
        updateNodeData(id, { output: uploadedUrl });
      } catch (error) {
        console.error(error);
        updateNodeData(id, { output: previousValue });
      } finally {
        URL.revokeObjectURL(previewUrl);
        setUploading(false);
      }
    },
    [data.output, id, updateNodeData, uploadCanvasMedia],
  );

  const confirmStopNode = useCallback(() => {
    cancelNodes([id]);
    setCancelConfirmOpen(false);
  }, [cancelNodes, id]);

  const output = data.output?.trim();

  return (
    <div
      className="group relative w-[300px] text-white"
      aria-busy={isNodeBusy}
      onMouseDownCapture={(event) => {
        if (!(event.target instanceof Element)) return;
        if (event.target.closest('[data-skip-node-select="true"]')) return;
        if (event.target.closest('.react-flow__handle')) return;
        selectSelf();
      }}
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

      <input
        ref={uploadInputRef}
        className="sr-only"
        type="file"
        accept="video/*"
        disabled={uploading}
        onChange={handleUploadCompositionVideo}
      />

      <Handle
        type="target"
        position={Position.Left}
        className="!left-[-7px] !z-[70] !h-3 !w-3 !cursor-crosshair !rounded-full !border-[2px] !border-white/72 !bg-[#202123] !shadow-none hover:!scale-[1.35] !transition-transform"
      />

      <div
        className={`lumen-node-card relative overflow-hidden rounded-[13px] bg-[#202123] ring-1 transition-all duration-200 ${
          isNodeBusy
            ? 'lumen-node-card--running ring-[#79e4ff]/42'
            : selected
              ? 'ring-white/28 shadow-[0_22px_70px_rgba(155,234,255,0.12)]'
              : 'ring-white/[0.1] hover:ring-white/[0.16]'
        }`}
      >
        {lowDetail ? <NodeLodOverlay kind="composition" title={nodeTitle} /> : null}
        <div className="border-b border-white/[0.06] px-2.5 py-2">
          <div className="flex items-center gap-2">
            <div className="min-w-0 flex-1">
              <input
                aria-label={t('canvas.node.title')}
                className="nodrag nopan h-6 w-full bg-transparent px-1 text-[12px] font-bold text-white/82 outline-none"
                onChange={(event) => updateNodeData(id, { title: event.target.value })}
                value={nodeTitle}
              />
              <div className="truncate px-1 text-[10px] font-bold text-white/38">
                {clipCount} {t('canvas.composition.clips')} · {totalDuration.toFixed(1)}s
              </div>
            </div>
            <button
              type="button"
              aria-label={t('canvas.composition.open')}
              title={t('canvas.composition.open')}
              data-skip-node-select="true"
              className="nodrag nopan flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-[#9beaff]/12 px-2.5 text-[10px] font-black text-[#9beaff] ring-1 ring-[#9beaff]/24 transition-colors hover:bg-[#9beaff]/18 hover:ring-[#9beaff]/38"
              onClick={handleOpenEditor}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <IconScissors size={14} stroke={2.4} />
              <span>{t('canvas.composition.open')}</span>
            </button>
            <button
              type="button"
              aria-label={uploading ? t('materials.uploading') : t('canvas.node.upload')}
              title={uploading ? t('materials.uploading') : t('canvas.node.upload')}
              data-skip-node-select="true"
              className="nodrag nopan flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/[0.08] text-white/66 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.14] hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
              disabled={uploading}
              onClick={(event) => {
                event.stopPropagation();
                uploadInputRef.current?.click();
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {uploading ? (
                <IconLoader2 size={14} className="animate-spin" />
              ) : (
                <IconUpload size={14} />
              )}
            </button>
          </div>
        </div>

        <div
          className="relative overflow-hidden bg-[#090a0c]"
          style={{ aspectRatio: previewAspectRatio }}
        >
          {output ? (
            <video
              className="absolute inset-0 h-full w-full bg-black object-cover"
              src={output}
              controls
              playsInline
              preload="metadata"
            >
              <track kind="captions" />
            </video>
          ) : (
            <button
              type="button"
              data-skip-node-select="true"
              className="nodrag nopan absolute inset-0 flex flex-col items-center justify-center gap-2 bg-[linear-gradient(160deg,rgba(155,234,255,0.12),rgba(28,29,34,0.98)_58%,rgba(8,9,10,0.96))] text-white/54 transition-colors hover:text-white/78"
              onClick={handleOpenEditor}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-[#9beaff]/12 text-[#9beaff] ring-1 ring-[#9beaff]/24">
                <IconScissors size={20} stroke={2.2} />
              </span>
              <span className="text-[11px] font-black">{t('canvas.composition.open')}</span>
            </button>
          )}
          <div className="pointer-events-none absolute left-2 top-2 rounded-full bg-black/58 px-2 py-1 text-[10px] font-black text-white/76 ring-1 ring-white/[0.08]">
            {timeline?.aspectRatio ?? '9:16'}
          </div>
          {isNodeBusy ? <div className="lumen-node-running-overlay absolute inset-0" /> : null}
        </div>

        <div className="flex items-center gap-2 p-2.5">
          <button
            type="button"
            data-skip-node-select="true"
            className="nodrag nopan flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[11px] bg-[#9beaff] text-[12px] font-black text-[#041015] disabled:cursor-not-allowed disabled:opacity-45"
            disabled={!canRun || isNodeBusy}
            onClick={handleRun}
          >
            <IconPlayerPlay size={15} stroke={2.6} />
            {t('canvas.node.run')}
          </button>
          {isNodeBusy ? (
            <button
              type="button"
              data-skip-node-select="true"
              className="nodrag nopan flex h-9 w-9 items-center justify-center rounded-[11px] bg-white/[0.08] text-white/72 ring-1 ring-white/[0.08]"
              onClick={(event) => {
                event.stopPropagation();
                setCancelConfirmOpen(true);
              }}
            >
              <IconPlayerStop size={15} stroke={2.4} />
            </button>
          ) : null}
        </div>

        {isNodeBusy ? (
          <div className="px-2.5 pb-2.5">
            <div className="h-1 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="lumen-node-progress-bar h-full rounded-r-full transition-all duration-300"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>
        ) : null}

        {nodeError ? (
          <div className="border-t border-white/[0.06] px-2.5 py-2 text-[11px] text-[#ff9f9f]">
            {nodeError}
          </div>
        ) : null}
      </div>

      <Handle
        type="source"
        position={Position.Right}
        className="!right-[-7px] !z-[70] !h-3 !w-3 !cursor-crosshair !rounded-full !border-[2px] !border-white/72 !bg-[#202123] !shadow-none hover:!scale-[1.35] !transition-transform"
      />

      <ConfirmDialog
        open={cancelConfirmOpen}
        message={t('canvas.node.cancelConfirm')}
        confirmLabel={t('canvas.node.stop')}
        cancelLabel={t('common.cancel')}
        variant="danger"
        onCancel={() => setCancelConfirmOpen(false)}
        onConfirm={confirmStopNode}
      />
    </div>
  );
}

export type { CompositionNodeData };
