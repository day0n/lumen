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

export function CompositionFlowNode(props: {
  data: CompositionNodeData;
  id: string;
  selected?: boolean;
}) {
  return <CompositionFlowNodeMemo {...props} />;
}

// See note in CanvasWorkbench's LumenFlowNode wrapper. Same reason: React
// Flow doesn't memoise custom node bodies, so a ws progress event on any
// other node forces composition nodes to re-render and rebuild their
// timeline subtree. The composition body is heavier than the regular node
// body (clip strip, scrubber, drawer state) so the win here is larger.
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

      <button
        type="button"
        data-skip-node-select="true"
        className="nodrag nopan absolute -top-4 right-14 z-[90] flex h-8 items-center gap-1.5 rounded-full bg-white px-3 text-[11px] font-black text-[#111315] shadow-[0_12px_30px_rgba(0,0,0,0.32)] transition-transform hover:scale-[1.03] disabled:cursor-not-allowed disabled:opacity-60"
        disabled={uploading}
        onClick={(event) => {
          event.stopPropagation();
          uploadInputRef.current?.click();
        }}
        onPointerDown={(event) => event.stopPropagation()}
      >
        {uploading ? <IconLoader2 size={14} className="animate-spin" /> : <IconUpload size={14} />}
        {uploading ? t('materials.uploading') : t('canvas.node.upload')}
      </button>
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
        <div className="border-b border-white/[0.06] p-2.5">
          <input
            aria-label={t('canvas.node.title')}
            className="nodrag nopan mb-2 h-6 w-full bg-transparent px-1 text-[12px] font-bold text-white/78 outline-none"
            onChange={(event) => updateNodeData(id, { title: event.target.value })}
            value={nodeTitle}
          />
          <button
            type="button"
            data-skip-node-select="true"
            className="relative flex w-full cursor-grab flex-col items-center justify-center gap-2 overflow-hidden rounded-[10px] bg-[linear-gradient(160deg,rgba(155,234,255,0.12),rgba(28,29,34,0.98)_54%,rgba(8,9,10,0.9))] px-4 py-6 ring-1 ring-white/[0.06] transition-colors hover:ring-[#9beaff]/28 active:cursor-grabbing"
            onClick={handleOpenEditor}
          >
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-[#9beaff]/14 text-[#9beaff] ring-1 ring-[#9beaff]/24">
              <IconScissors size={22} stroke={2.2} />
            </span>
            <span className="text-[13px] font-bold text-white/86">
              {t('canvas.composition.open')}
            </span>
            <span className="text-[11px] text-white/42">
              {clipCount} {t('canvas.composition.clips')} · {totalDuration.toFixed(1)}s
            </span>
            {output && !output.startsWith('blob:') ? (
              <video
                className="pointer-events-none mt-1 max-h-24 w-full rounded-[8px] object-cover"
                src={output}
                muted
                playsInline
                preload="metadata"
              >
                <track kind="captions" />
              </video>
            ) : null}
            {isNodeBusy ? <div className="lumen-node-running-overlay absolute inset-0" /> : null}
          </button>
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
