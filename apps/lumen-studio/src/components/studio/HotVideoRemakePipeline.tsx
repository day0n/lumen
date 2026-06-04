'use client';

import { type NodeState, useWorkflowWs } from '@/features/workflow/use-workflow-ws';
import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/cn';
import {
  type LumenCanvas,
  type LumenCanvasNode,
  type NodeStatus,
  RemakeNodeIds,
  type RemakeRunBoundaries,
  type RemakeScene,
  canvasEdgesToWorkflowEdges,
  canvasNodeToWorkflowNodeWithContext,
} from '@lumen/shared/domain';
import {
  IconArrowLeft,
  IconCheck,
  IconDownload,
  IconLoader2,
  IconMusic,
  IconPlayerPlay,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export interface RemakeShotInfo {
  startSec: number;
  endSec: number;
  action: string;
  camera: string;
  visual: string;
  dialogue?: string;
}

export interface RemakeTranscriptItem {
  startSec: number;
  endSec: number;
  text: string;
}

export interface RemakeBreakdownInfo {
  durationSec: number;
  hook: string;
  angle: string;
  summary: string;
  transcript: RemakeTranscriptItem[];
  shots: RemakeShotInfo[];
  language: string;
}

export interface HotVideoRemakeSession {
  projectId: string;
  ownerId: string;
  /** 源爆款视频 id（如有），用于 Gate 1 replan 时回查拆解缓存 */
  videoId?: string;
  reference: {
    id: string;
    label: string;
    value: string;
    source: 'link' | 'video';
    title?: string;
    productName?: string;
    category?: string;
    region?: string;
    thumbnailUrl?: string;
    previewUrl?: string;
    hook?: string;
    angle?: string;
    structure?: string[];
  };
  canvas: LumenCanvas;
  scenes: RemakeScene[];
  scriptText: string;
  sellingPoints: string[];
  audienceTags: string[];
  boundaries: RemakeRunBoundaries;
  productImageUrls: string[];
  creatorImageUrls?: string[];
  breakdown?: RemakeBreakdownInfo | null;
  /** Gate 1 replan 时回传给后端，这样配置弹窗里的参数能保留 */
  settings?: {
    aspectRatio?: string;
    resolution?: string;
    language?: 'zh' | 'en';
    duration?: number;
  };
  prompt?: string;
}

export function HotVideoRemakePipeline({
  session: initialSession,
  onBack,
}: {
  session: HotVideoRemakeSession;
  onBack: () => void;
}) {
  const { locale } = useI18n();
  const copy = getCopy(locale);
  // 会话状态：Gate 1 重算后由后端回传新会话整体替换。
  const [session, setSession] = useState<HotVideoRemakeSession>(initialSession);
  const [activeStep, setActiveStep] = useState(0);
  const [canvas, setCanvas] = useState<LumenCanvas>(initialSession.canvas);
  const [canvasToSave, setCanvasToSave] = useState<LumenCanvas | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [scriptText, setScriptText] = useState(initialSession.scriptText);
  const [sellingPointsText, setSellingPointsText] = useState(
    initialSession.sellingPoints.join('\n'),
  );
  const [audienceTagsText, setAudienceTagsText] = useState(initialSession.audienceTags.join('\n'));
  const [voiceLanguage, setVoiceLanguage] = useState(
    initialSession.settings?.language === 'zh'
      ? '中文'
      : initialSession.settings?.language === 'en'
        ? 'English'
        : locale === 'zh'
          ? '中文'
          : 'English',
  );
  const [replanLoading, setReplanLoading] = useState(false);
  const [replanError, setReplanError] = useState<string | null>(null);
  const lastSavedCanvas = useRef(JSON.stringify(initialSession.canvas));

  // 入口 session prop 切换时（用户从复刻页换了一条爆款），整盘重置。
  useEffect(() => {
    setSession(initialSession);
    setActiveStep(0);
    setCanvas(initialSession.canvas);
    setCanvasToSave(null);
    setSaveError(null);
    setScriptText(initialSession.scriptText);
    setSellingPointsText(initialSession.sellingPoints.join('\n'));
    setAudienceTagsText(initialSession.audienceTags.join('\n'));
    setVoiceLanguage(
      initialSession.settings?.language === 'zh'
        ? '中文'
        : initialSession.settings?.language === 'en'
          ? 'English'
          : locale === 'zh'
            ? '中文'
            : 'English',
    );
    setReplanError(null);
    lastSavedCanvas.current = JSON.stringify(initialSession.canvas);
  }, [locale, initialSession]);

  const wsUrl = useMemo(() => {
    if (typeof window === 'undefined') return '';
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    return `${protocol}//${window.location.host}/ws/flow`;
  }, []);

  const queueCanvasSave = useCallback((nextCanvas: LumenCanvas) => {
    setCanvasToSave(nextCanvas);
  }, []);

  const updateCanvas = useCallback(
    (updater: (current: LumenCanvas) => LumenCanvas, shouldSave = false) => {
      setCanvas((current) => {
        const next = updater(current);
        if (shouldSave) queueCanvasSave(next);
        return next;
      });
    },
    [queueCanvasSave],
  );

  const handleNodeStateChange = useCallback(
    (nodeId: string, state: NodeState) => {
      updateCanvas((current) => {
        const next: LumenCanvas = {
          ...current,
          nodes: current.nodes.map((node) => {
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
        };
        if (
          state.status === 'success' ||
          state.status === 'error' ||
          state.status === 'cancelled'
        ) {
          queueCanvasSave(next);
        }
        return next;
      });
    },
    [queueCanvasSave, updateCanvas],
  );

  const { connectionError, runNodes } = useWorkflowWs({
    url: wsUrl,
    projectId: session.projectId,
    workflowId: session.projectId,
    userId: session.ownerId,
    locale,
    onNodeStateChange: handleNodeStateChange,
  });

  const nodeById = useMemo(
    () => new Map(canvas.nodes.map((node) => [node.id, node])),
    [canvas.nodes],
  );
  const workflowNodes = useMemo(
    () => canvas.nodes.map((node) => canvasNodeToWorkflowNodeWithContext(canvas, node)),
    [canvas],
  );
  const workflowEdges = useMemo(() => canvasEdgesToWorkflowEdges(canvas.edges), [canvas.edges]);

  useEffect(() => {
    if (!canvasToSave) return;
    const serialized = JSON.stringify(canvasToSave);
    if (serialized === lastSavedCanvas.current) return;
    const timer = window.setTimeout(() => {
      void fetch(`/api/projects/${session.projectId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-lumen-locale': locale },
        body: JSON.stringify({ canvas: canvasToSave }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error(await response.text());
          lastSavedCanvas.current = serialized;
          setSaveError(null);
        })
        .catch((error) => setSaveError(error instanceof Error ? error.message : copy.saveFailed));
    }, 650);
    return () => window.clearTimeout(timer);
  }, [canvasToSave, copy.saveFailed, locale, session.projectId]);

  const runNodeIds = useCallback(
    (nodeIds: string[], step: number) => {
      setActiveStep(step);
      runNodes(nodeIds, workflowNodes, workflowEdges);
    },
    [runNodes, workflowEdges, workflowNodes],
  );

  const applyScriptToCanvas = useCallback(
    (nextScriptText: string) => {
      updateCanvas(
        (current) => ({
          ...current,
          nodes: current.nodes.map((node) => {
            if (node.id !== RemakeNodeIds.script) return node;
            return {
              ...node,
              data: {
                ...node.data,
                prompt: nextScriptText,
                output: nextScriptText,
                status: 'success',
                error: null,
                progress: 1,
              },
            };
          }),
        }),
        true,
      );
    },
    [updateCanvas],
  );

  /** Gate 1 真门控：调后端 replan，用户编辑过的 script/sellingPoints/audience/language 作为强约束，
   *  Gemini 重写所有下游 prompt，画布整体替换；下游节点状态自然回到 idle，等待用户重新跑。 */
  const handleGate1Confirm = useCallback(async () => {
    if (replanLoading) return;
    setReplanLoading(true);
    setReplanError(null);
    const points = sellingPointsText
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    const audiences = audienceTagsText
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    const language: 'zh' | 'en' = voiceLanguage === '中文' ? 'zh' : 'en';
    try {
      const response = await fetch('/api/hot-videos/remake/replan', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-lumen-locale': locale,
        },
        body: JSON.stringify({
          projectId: session.projectId,
          ...(session.videoId ? { videoId: session.videoId } : {}),
          reference: {
            id: session.reference.id,
            label: session.reference.label,
            value: session.reference.value,
            source: session.reference.source,
          },
          productImageUrls: session.productImageUrls,
          ...(session.creatorImageUrls?.length
            ? { creatorImageUrls: session.creatorImageUrls }
            : {}),
          ...(session.prompt ? { prompt: session.prompt } : {}),
          scriptText,
          sellingPoints: points,
          audienceTags: audiences,
          settings: {
            ...(session.settings?.aspectRatio ? { aspectRatio: session.settings.aspectRatio } : {}),
            ...(session.settings?.resolution ? { resolution: session.settings.resolution } : {}),
            ...(session.settings?.duration ? { duration: session.settings.duration } : {}),
            language,
          },
        }),
      });
      const payload = (await response.json()) as {
        ok: boolean;
        data?: HotVideoRemakeSession;
        error?: { message?: string };
      };
      if (!response.ok || !payload.ok || !payload.data) {
        throw new Error(payload.error?.message ?? copy.replanFailed);
      }
      const next = payload.data;
      setSession(next);
      setCanvas(next.canvas);
      setCanvasToSave(null);
      setScriptText(next.scriptText);
      setSellingPointsText(next.sellingPoints.join('\n'));
      setAudienceTagsText(next.audienceTags.join('\n'));
      lastSavedCanvas.current = JSON.stringify(next.canvas);
      setActiveStep(2); // 直接跳到"形象锁定"，因为下游已经被重新规划。
    } catch (error) {
      setReplanError(error instanceof Error ? error.message : copy.replanFailed);
    } finally {
      setReplanLoading(false);
    }
  }, [
    audienceTagsText,
    copy.replanFailed,
    locale,
    replanLoading,
    scriptText,
    sellingPointsText,
    session.creatorImageUrls,
    session.productImageUrls,
    session.projectId,
    session.prompt,
    session.reference,
    session.settings,
    session.videoId,
    voiceLanguage,
  ]);

  /** 把一组节点强制重置为 idle，并清空 output —— Gate 2 / 重跑分镜后调，让用户能再触发下游。 */
  const resetNodes = useCallback(
    (nodeIds: string[]) => {
      if (nodeIds.length === 0) return;
      const ids = new Set(nodeIds);
      updateCanvas(
        (current) => ({
          ...current,
          nodes: current.nodes.map((node) => {
            if (!ids.has(node.id)) return node;
            return {
              ...node,
              data: {
                ...node.data,
                output: null,
                status: 'idle',
                error: null,
                progress: 0,
              },
            };
          }),
        }),
        true,
      );
    },
    [updateCanvas],
  );

  /** Gate 2：分镜确认后，把下游的视频+口播+混音+成片全部重置回 idle，等待用户进入视频阶段时再跑。 */
  const handleGate2Confirm = useCallback(() => {
    const downstream = [
      ...session.boundaries.videoNodes,
      ...session.boundaries.voiceNodes,
      ...session.boundaries.sceneMixNodes,
      session.boundaries.bgmNode,
      session.boundaries.finalNode,
    ];
    resetNodes(downstream);
    setActiveStep(4);
  }, [
    resetNodes,
    session.boundaries.bgmNode,
    session.boundaries.finalNode,
    session.boundaries.sceneMixNodes,
    session.boundaries.videoNodes,
    session.boundaries.voiceNodes,
  ]);

  /** 视频阶段一并跑：scene 视频 + 场景口播 + 场景混音 + 全片 BGM。
   *  engine 按拓扑顺序处理，mix 等 video+voice 完成后自动启动。 */
  const videoStageNodeIds = useMemo(
    () => [
      ...session.boundaries.videoNodes,
      ...session.boundaries.voiceNodes,
      ...session.boundaries.sceneMixNodes,
      session.boundaries.bgmNode,
    ],
    [
      session.boundaries.bgmNode,
      session.boundaries.sceneMixNodes,
      session.boundaries.videoNodes,
      session.boundaries.voiceNodes,
    ],
  );

  const lockStatus = aggregateStatus(session.boundaries.lockNodes, nodeById);
  const storyboardStatus = aggregateStatus(session.boundaries.storyboardNodes, nodeById);
  const videoStatus = aggregateStatus(videoStageNodeIds, nodeById);
  const finalStatus = aggregateStatus([session.boundaries.finalNode], nodeById);
  const finalNode = nodeById.get(session.boundaries.finalNode);

  return (
    <main className="relative z-10 mx-auto max-w-[1260px] px-6 pb-20 pt-28">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={onBack}
          className="flex h-10 items-center gap-2 rounded-xl bg-white/[0.06] px-3 text-[13px] font-semibold text-white/70 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.1] hover:text-white"
        >
          <IconArrowLeft size={16} stroke={2.2} />
          {copy.back}
        </button>
        <div className="min-w-0">
          <div className="text-[12px] font-semibold text-white/38">{copy.inPageWorkflow}</div>
          <h1 className="truncate text-[22px] font-bold text-white">{session.reference.label}</h1>
        </div>
        <div className="ml-auto rounded-full bg-[#79e4ff]/12 px-3 py-1.5 text-[12px] font-semibold text-[#79e4ff] ring-1 ring-[#79e4ff]/20">
          {copy.hiddenCanvas}
        </div>
      </div>

      <div className="mb-5 grid gap-2 md:grid-cols-6">
        {copy.steps.map((step, index) => (
          <button
            key={step}
            type="button"
            onClick={() => setActiveStep(index)}
            className={cn(
              'flex h-12 items-center gap-2 rounded-xl px-3 text-left text-[12px] font-bold ring-1 transition-colors',
              activeStep === index
                ? 'bg-white text-[#111315] ring-white'
                : 'bg-white/[0.055] text-white/58 ring-white/[0.07] hover:bg-white/[0.09] hover:text-white',
            )}
          >
            <span
              className={cn(
                'flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px]',
                activeStep === index ? 'bg-[#111315] text-white' : 'bg-white/[0.08] text-white/58',
              )}
            >
              {index + 1}
            </span>
            <span className="min-w-0 truncate">{step}</span>
          </button>
        ))}
      </div>

      {(connectionError || saveError) && (
        <div className="mb-4 rounded-xl bg-[#f5c76a]/10 px-4 py-3 text-[12px] leading-5 text-[#f5c76a] ring-1 ring-[#f5c76a]/20">
          {connectionError ?? saveError}
        </div>
      )}

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <ReferencePreview session={session} copy={copy} />
          <div className="rounded-[18px] bg-[#15171a]/88 p-4 ring-1 ring-white/[0.08]">
            <div className="text-[13px] font-bold text-white">{copy.productImages}</div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {session.productImageUrls.map((url) => (
                <img
                  key={url}
                  src={url}
                  alt=""
                  className="aspect-square rounded-xl bg-black object-cover ring-1 ring-white/[0.08]"
                />
              ))}
            </div>
          </div>
        </aside>

        <section className="min-h-[640px] rounded-[18px] bg-[#111315]/92 p-5 ring-1 ring-white/[0.08]">
          {activeStep === 0 && (
            <BreakdownStage copy={copy} session={session} onNext={() => setActiveStep(1)} />
          )}

          {activeStep === 1 && (
            <ScriptStage
              copy={copy}
              scriptText={scriptText}
              sellingPointsText={sellingPointsText}
              audienceTagsText={audienceTagsText}
              voiceLanguage={voiceLanguage}
              replanLoading={replanLoading}
              replanError={replanError}
              onScriptChange={setScriptText}
              onSellingPointsChange={setSellingPointsText}
              onAudienceTagsChange={setAudienceTagsText}
              onLanguageChange={setVoiceLanguage}
              onApply={() => applyScriptToCanvas(scriptText)}
              onConfirm={() => {
                void handleGate1Confirm();
              }}
            />
          )}

          {activeStep === 2 && (
            <NodeStage
              copy={copy}
              title={copy.creatorLock}
              description={copy.creatorLockDesc}
              status={lockStatus}
              nodes={session.boundaries.lockNodes
                .map((nodeId) => nodeById.get(nodeId))
                .filter((node): node is LumenCanvasNode => Boolean(node))}
              runLabel={copy.runCreatorLock}
              nextLabel={copy.nextStoryboard}
              onRun={() => runNodeIds(session.boundaries.lockNodes, 2)}
              onNext={() => setActiveStep(3)}
            />
          )}

          {activeStep === 3 && (
            <StoryboardStage
              copy={copy}
              scenes={session.scenes}
              status={storyboardStatus}
              nodeById={nodeById}
              nodeIds={session.boundaries.storyboardNodes}
              onRunAll={() => runNodeIds(session.boundaries.storyboardNodes, 3)}
              onRunOne={(nodeId) => {
                // 单张重跑分镜后，下游的视频/口播/混音/成片会拿到新分镜首帧，
                // 直接重置那一场对应的下游节点 + 全片成片，强制用户重新走视频阶段。
                const sceneIndex = session.boundaries.storyboardNodes.indexOf(nodeId);
                if (sceneIndex >= 0) {
                  const downstream = [
                    session.boundaries.videoNodes[sceneIndex],
                    session.boundaries.voiceNodes[sceneIndex],
                    session.boundaries.sceneMixNodes[sceneIndex],
                    session.boundaries.finalNode,
                  ].filter((id): id is string => Boolean(id));
                  resetNodes(downstream);
                }
                runNodeIds([nodeId], 3);
              }}
              onNext={handleGate2Confirm}
            />
          )}

          {activeStep === 4 && (
            <VideoStage
              copy={copy}
              status={videoStatus}
              videoNodes={session.boundaries.videoNodes
                .map((nodeId) => nodeById.get(nodeId))
                .filter((node): node is LumenCanvasNode => Boolean(node))}
              voiceNodes={session.boundaries.voiceNodes
                .map((nodeId) => nodeById.get(nodeId))
                .filter((node): node is LumenCanvasNode => Boolean(node))}
              mixNodes={session.boundaries.sceneMixNodes
                .map((nodeId) => nodeById.get(nodeId))
                .filter((node): node is LumenCanvasNode => Boolean(node))}
              bgmNode={nodeById.get(session.boundaries.bgmNode)}
              onRun={() => runNodeIds(videoStageNodeIds, 4)}
              onNext={() => setActiveStep(5)}
            />
          )}

          {activeStep === 5 && (
            <FinalStage
              copy={copy}
              status={finalStatus}
              finalNode={finalNode}
              canRun={videoStatus === 'success'}
              onRun={() => runNodeIds([session.boundaries.finalNode], 5)}
            />
          )}
        </section>
      </div>
    </main>
  );
}

function BreakdownStage({
  copy,
  session,
  onNext,
}: {
  copy: ReturnType<typeof getCopy>;
  session: HotVideoRemakeSession;
  onNext: () => void;
}) {
  const breakdown = session.breakdown ?? null;
  return (
    <div>
      <StageHeader title={copy.breakdownTitle} description={copy.breakdownDesc} />

      {breakdown ? (
        <div className="mt-5 rounded-[16px] bg-[#9da8ff]/8 px-4 py-3 text-[12px] leading-5 text-white/70 ring-1 ring-[#9da8ff]/18">
          <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-wide text-[#9da8ff]">
            <IconCheck size={13} stroke={2.4} />
            {copy.breakdownReal}
          </div>
          {breakdown.summary}
        </div>
      ) : (
        <div className="mt-5 rounded-[16px] bg-[#f5c76a]/8 px-4 py-3 text-[12px] leading-5 text-[#f5c76a] ring-1 ring-[#f5c76a]/18">
          {copy.breakdownTextOnly}
        </div>
      )}

      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <InfoBlock title={copy.referenceSignals}>
          <InfoLine label={copy.hook} value={session.reference.hook ?? '-'} />
          <InfoLine label={copy.angle} value={session.reference.angle ?? '-'} />
          <InfoLine label={copy.category} value={session.reference.category ?? '-'} />
          <InfoLine label={copy.region} value={session.reference.region ?? '-'} />
        </InfoBlock>
        <InfoBlock title={copy.remixTargets}>
          <InfoLine label={copy.sellingPoints} value={session.sellingPoints.join(' / ')} />
          <InfoLine label={copy.audienceTags} value={session.audienceTags.join(' / ')} />
        </InfoBlock>
      </div>

      <div className="mt-5 overflow-hidden rounded-[16px] ring-1 ring-white/[0.08]">
        <table className="w-full border-collapse text-left text-[12px]">
          <thead className="bg-white/[0.06] text-white/42">
            <tr>
              <th className="px-4 py-3 font-semibold">{copy.scene}</th>
              <th className="px-4 py-3 font-semibold">{copy.action}</th>
              <th className="px-4 py-3 font-semibold">{copy.voiceLine}</th>
              <th className="px-4 py-3 font-semibold">{copy.duration}</th>
            </tr>
          </thead>
          <tbody>
            {session.scenes.map((scene) => (
              <tr key={scene.index} className="border-t border-white/[0.06] text-white/72">
                <td className="px-4 py-3 font-bold text-white">{scene.index}</td>
                <td className="px-4 py-3 leading-5">{scene.action}</td>
                <td className="px-4 py-3 leading-5">{scene.voiceLine ?? scene.dialogue}</td>
                <td className="px-4 py-3">{scene.durationSeconds}s</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {breakdown && breakdown.transcript.length > 0 ? (
        <details className="mt-5 group rounded-[16px] bg-white/[0.045] ring-1 ring-white/[0.06]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[12px] font-bold text-white/72 hover:text-white">
            <span>{copy.originalTranscript}</span>
            <span className="text-white/38 group-open:rotate-180 transition-transform">▾</span>
          </summary>
          <div className="border-t border-white/[0.06] px-4 py-3 space-y-1.5">
            {breakdown.transcript.map((item, idx) => (
              <div
                key={`${item.startSec}-${idx}`}
                className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 text-[12px] leading-5"
              >
                <div className="text-white/36">
                  {item.startSec.toFixed(1)}-{item.endSec.toFixed(1)}s
                </div>
                <div className="text-white/72">{item.text}</div>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      {breakdown && breakdown.shots.length > 0 ? (
        <details className="mt-3 group rounded-[16px] bg-white/[0.045] ring-1 ring-white/[0.06]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[12px] font-bold text-white/72 hover:text-white">
            <span>{copy.originalShots}</span>
            <span className="text-white/38 group-open:rotate-180 transition-transform">▾</span>
          </summary>
          <div className="border-t border-white/[0.06] px-4 py-3 space-y-2.5">
            {breakdown.shots.map((shot, idx) => (
              <div
                key={`${shot.startSec}-${idx}`}
                className="grid grid-cols-[64px_minmax(0,1fr)] gap-3 text-[12px] leading-5"
              >
                <div className="text-white/36">
                  {shot.startSec.toFixed(1)}-{shot.endSec.toFixed(1)}s
                </div>
                <div className="text-white/72">
                  <div className="font-semibold text-white/88">{shot.action}</div>
                  <div className="text-white/48 text-[11px]">{shot.camera}</div>
                  <div className="text-white/56 text-[11px]">{shot.visual}</div>
                  {shot.dialogue ? (
                    <div className="text-[#9da8ff] text-[11px] mt-0.5">「{shot.dialogue}」</div>
                  ) : null}
                </div>
              </div>
            ))}
          </div>
        </details>
      ) : null}

      <div className="mt-5 flex justify-end">
        <PrimaryButton onClick={onNext}>{copy.reviewScript}</PrimaryButton>
      </div>
    </div>
  );
}

function ScriptStage({
  copy,
  scriptText,
  sellingPointsText,
  audienceTagsText,
  voiceLanguage,
  replanLoading,
  replanError,
  onScriptChange,
  onSellingPointsChange,
  onAudienceTagsChange,
  onLanguageChange,
  onApply,
  onConfirm,
}: {
  copy: ReturnType<typeof getCopy>;
  scriptText: string;
  sellingPointsText: string;
  audienceTagsText: string;
  voiceLanguage: string;
  replanLoading: boolean;
  replanError: string | null;
  onScriptChange: (value: string) => void;
  onSellingPointsChange: (value: string) => void;
  onAudienceTagsChange: (value: string) => void;
  onLanguageChange: (value: string) => void;
  onApply: () => void;
  onConfirm: () => void;
}) {
  return (
    <div>
      <StageHeader title={copy.scriptTitle} description={copy.scriptDesc} />
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <textarea
          value={scriptText}
          onChange={(event) => onScriptChange(event.target.value)}
          onBlur={onApply}
          className="min-h-[430px] resize-none rounded-[16px] bg-white/[0.045] px-4 py-4 text-[13px] leading-6 text-white outline-none ring-1 ring-white/[0.08] focus:ring-[#79e4ff]/35"
        />
        <div className="space-y-4">
          <EditableList
            label={copy.sellingPoints}
            value={sellingPointsText}
            onChange={onSellingPointsChange}
          />
          <EditableList
            label={copy.audienceTags}
            value={audienceTagsText}
            onChange={onAudienceTagsChange}
          />
          <label className="block">
            <span className="text-[12px] font-bold text-white/62">{copy.language}</span>
            <select
              value={voiceLanguage}
              onChange={(event) => onLanguageChange(event.target.value)}
              className="mt-2 h-11 w-full rounded-xl bg-white/[0.06] px-3 text-[13px] font-semibold text-white outline-none ring-1 ring-white/[0.08]"
            >
              <option className="bg-[#111315] text-white">中文</option>
              <option className="bg-[#111315] text-white">English</option>
            </select>
          </label>
          <div className="rounded-xl bg-[#9da8ff]/8 px-3 py-2.5 text-[11px] leading-5 text-white/62 ring-1 ring-[#9da8ff]/16">
            {copy.gate1Hint}
          </div>
        </div>
      </div>
      {replanError ? (
        <div className="mt-4 rounded-xl bg-[#f5c76a]/10 px-4 py-3 text-[12px] leading-5 text-[#f5c76a] ring-1 ring-[#f5c76a]/20">
          {replanError}
        </div>
      ) : null}
      <div className="mt-5 flex justify-end">
        <PrimaryButton onClick={onConfirm} disabled={replanLoading}>
          {replanLoading ? (
            <IconLoader2 size={15} className="animate-spin" />
          ) : (
            <IconCheck size={15} />
          )}
          {replanLoading ? copy.gate1Loading : copy.confirmGate1}
        </PrimaryButton>
      </div>
    </div>
  );
}

function NodeStage({
  copy,
  title,
  description,
  status,
  nodes,
  runLabel,
  nextLabel,
  onRun,
  onNext,
}: {
  copy: ReturnType<typeof getCopy>;
  title: string;
  description: string;
  status: NodeStatus;
  nodes: LumenCanvasNode[];
  runLabel: string;
  nextLabel: string;
  onRun: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <StageHeader title={title} description={description} status={status} />
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        {nodes.map((node) => (
          <NodePreview key={node.id} node={node} copy={copy} />
        ))}
      </div>
      <StageActions
        status={status}
        runLabel={runLabel}
        nextLabel={nextLabel}
        onRun={onRun}
        onNext={onNext}
      />
    </div>
  );
}

function StoryboardStage({
  copy,
  scenes,
  status,
  nodeById,
  nodeIds,
  onRunAll,
  onRunOne,
  onNext,
}: {
  copy: ReturnType<typeof getCopy>;
  scenes: RemakeScene[];
  status: NodeStatus;
  nodeById: Map<string, LumenCanvasNode>;
  nodeIds: string[];
  onRunAll: () => void;
  onRunOne: (nodeId: string) => void;
  onNext: () => void;
}) {
  return (
    <div>
      <StageHeader title={copy.storyboardTitle} description={copy.storyboardDesc} status={status} />
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {nodeIds.map((nodeId, index) => {
          const node = nodeById.get(nodeId);
          if (!node) return null;
          return (
            <div key={nodeId} className="space-y-2">
              <NodePreview
                node={node}
                copy={copy}
                label={`${copy.scene} ${scenes[index]?.index ?? index + 1}`}
              />
              <button
                type="button"
                onClick={() => onRunOne(nodeId)}
                className="h-9 w-full rounded-xl bg-white/[0.06] text-[12px] font-bold text-white/58 ring-1 ring-white/[0.08] hover:bg-white/[0.1] hover:text-white"
              >
                {copy.rerunOne}
              </button>
            </div>
          );
        })}
      </div>
      <StageActions
        status={status}
        runLabel={copy.runStoryboard}
        nextLabel={copy.confirmGate2}
        onRun={onRunAll}
        onNext={onNext}
      />
    </div>
  );
}

function VideoStage({
  copy,
  status,
  videoNodes,
  voiceNodes,
  mixNodes,
  bgmNode,
  onRun,
  onNext,
}: {
  copy: ReturnType<typeof getCopy>;
  status: NodeStatus;
  videoNodes: LumenCanvasNode[];
  voiceNodes: LumenCanvasNode[];
  mixNodes: LumenCanvasNode[];
  bgmNode?: LumenCanvasNode;
  onRun: () => void;
  onNext: () => void;
}) {
  return (
    <div>
      <StageHeader title={copy.videoTitle} description={copy.videoDesc} status={status} />
      {videoNodes.length > 0 ? (
        <div className="mt-5">
          <div className="mb-2 text-[12px] font-bold uppercase tracking-wide text-white/40">
            {copy.sectionScene}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {videoNodes.map((node) => (
              <NodePreview key={node.id} node={node} copy={copy} />
            ))}
          </div>
        </div>
      ) : null}
      {voiceNodes.length > 0 ? (
        <div className="mt-5">
          <div className="mb-2 text-[12px] font-bold uppercase tracking-wide text-white/40">
            {copy.sectionVoice}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {voiceNodes.map((node) => (
              <NodePreview key={node.id} node={node} copy={copy} icon={<IconMusic size={16} />} />
            ))}
          </div>
        </div>
      ) : null}
      {mixNodes.length > 0 ? (
        <div className="mt-5">
          <div className="mb-2 text-[12px] font-bold uppercase tracking-wide text-white/40">
            {copy.sectionMix}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {mixNodes.map((node) => (
              <NodePreview key={node.id} node={node} copy={copy} />
            ))}
          </div>
        </div>
      ) : null}
      {bgmNode ? (
        <div className="mt-5">
          <div className="mb-2 text-[12px] font-bold uppercase tracking-wide text-white/40">
            {copy.sectionBgm}
          </div>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            <NodePreview node={bgmNode} copy={copy} icon={<IconMusic size={18} />} />
          </div>
        </div>
      ) : null}
      <StageActions
        status={status}
        runLabel={copy.runVideos}
        nextLabel={copy.nextFinal}
        onRun={onRun}
        onNext={onNext}
      />
    </div>
  );
}

function FinalStage({
  copy,
  status,
  finalNode,
  canRun,
  onRun,
}: {
  copy: ReturnType<typeof getCopy>;
  status: NodeStatus;
  finalNode?: LumenCanvasNode;
  canRun: boolean;
  onRun: () => void;
}) {
  const output = readNodeOutput(finalNode);
  const running = status === 'queued' || status === 'running';
  return (
    <div>
      <StageHeader title={copy.finalTitle} description={copy.finalDesc} status={status} />
      <div className="mt-5">
        {finalNode ? (
          <NodePreview node={finalNode} copy={copy} className="mx-auto max-w-[360px]" />
        ) : (
          <EmptyPreview copy={copy} />
        )}
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
        {output ? (
          <a
            href={output}
            download
            target="_blank"
            rel="noreferrer"
            className="flex h-11 items-center gap-2 rounded-xl bg-white/[0.07] px-4 text-[13px] font-bold text-white/70 ring-1 ring-white/[0.08] hover:bg-white/[0.1] hover:text-white"
          >
            <IconDownload size={15} stroke={2.2} />
            {copy.download}
          </a>
        ) : null}
        <PrimaryButton onClick={onRun} disabled={!canRun || running}>
          {running ? (
            <IconLoader2 size={15} className="animate-spin" />
          ) : (
            <IconPlayerPlay size={15} />
          )}
          {copy.runFinal}
        </PrimaryButton>
      </div>
    </div>
  );
}

function ReferencePreview({
  session,
  copy,
}: {
  session: HotVideoRemakeSession;
  copy: ReturnType<typeof getCopy>;
}) {
  const { reference } = session;
  return (
    <div className="overflow-hidden rounded-[18px] bg-[#15171a]/88 ring-1 ring-white/[0.08]">
      <div className="relative aspect-[9/16] bg-black">
        {reference.previewUrl ? (
          <video
            src={reference.previewUrl}
            poster={reference.thumbnailUrl}
            autoPlay
            muted
            loop
            playsInline
            controls
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : reference.thumbnailUrl ? (
          <img
            src={reference.thumbnailUrl}
            alt={reference.title ?? reference.label}
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(121,228,255,0.26),transparent_34%),linear-gradient(145deg,#14181d,#2b3340_52%,#090b0d)]" />
        )}
        <div className="absolute inset-x-0 bottom-0 bg-[linear-gradient(180deg,transparent,rgba(0,0,0,0.82))] px-4 pb-4 pt-20">
          <div className="text-[13px] font-bold text-white">
            {reference.title ?? reference.label}
          </div>
          <div className="mt-1 text-[11px] text-white/48">{reference.region ?? copy.reference}</div>
        </div>
      </div>
    </div>
  );
}

function StageHeader({
  title,
  description,
  status,
}: {
  title: string;
  description: string;
  status?: NodeStatus;
}) {
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-[20px] font-bold text-white">{title}</h2>
        <p className="mt-1 text-[13px] leading-6 text-white/42">{description}</p>
      </div>
      {status ? <StatusPill status={status} /> : null}
    </div>
  );
}

function StageActions({
  status,
  runLabel,
  nextLabel,
  onRun,
  onNext,
}: {
  status: NodeStatus;
  runLabel: string;
  nextLabel: string;
  onRun: () => void;
  onNext: () => void;
}) {
  const running = status === 'queued' || status === 'running';
  return (
    <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
      <button
        type="button"
        onClick={onRun}
        disabled={running}
        className="flex h-11 items-center gap-2 rounded-xl bg-white/[0.07] px-4 text-[13px] font-bold text-white/70 ring-1 ring-white/[0.08] hover:bg-white/[0.1] hover:text-white disabled:cursor-wait disabled:opacity-55"
      >
        {running ? (
          <IconLoader2 size={15} className="animate-spin" />
        ) : (
          <IconPlayerPlay size={15} />
        )}
        {runLabel}
      </button>
      <PrimaryButton onClick={onNext} disabled={status !== 'success'}>
        <IconCheck size={15} />
        {nextLabel}
      </PrimaryButton>
    </div>
  );
}

function NodePreview({
  node,
  copy,
  label,
  icon,
  className,
}: {
  node: LumenCanvasNode;
  copy: ReturnType<typeof getCopy>;
  label?: string;
  icon?: ReactNode;
  className?: string;
}) {
  const status = node.data.status ?? 'idle';
  const output = readNodeOutput(node);
  const isBusy = status === 'queued' || status === 'running';
  const rawProgress = node.data.progress;
  const hasKnownProgress = typeof rawProgress === 'number' && rawProgress > 0;
  const progressValue = rawProgress ?? (status === 'running' ? 0.45 : 0);
  const progressPercent = Math.max(isBusy ? 14 : 0, Math.round(progressValue * 100));
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[16px] bg-white/[0.045] ring-1 ring-white/[0.08]',
        className,
      )}
    >
      <div className="flex h-10 items-center gap-2 border-b border-white/[0.06] px-3">
        <span className="text-white/48">{icon}</span>
        <div className="min-w-0 flex-1 truncate text-[12px] font-bold text-white/74">
          {label ?? node.data.title}
        </div>
        <StatusDot status={status} />
      </div>
      <div className="relative aspect-[9/16] bg-black/52">
        {output ? (
          node.data.kind === 'image' ? (
            <img src={output} alt="" className="absolute inset-0 h-full w-full object-cover" />
          ) : node.data.kind === 'video' ? (
            // biome-ignore lint/a11y/useMediaCaption: Generated preview media has no WebVTT track before final editing.
            <video
              src={output}
              controls
              playsInline
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : node.data.kind === 'audio' ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-5 text-center">
              <IconMusic size={34} className="text-[#79e4ff]" stroke={1.8} />
              {/* biome-ignore lint/a11y/useMediaCaption: Generated music previews do not have a useful caption track. */}
              <audio src={output} controls className="w-full" />
            </div>
          ) : (
            <pre className="h-full overflow-auto whitespace-pre-wrap p-4 text-[12px] leading-5 text-white/72">
              {output}
            </pre>
          )
        ) : isBusy ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-[12px] text-white/52">
            <IconLoader2 size={22} className="animate-spin" />
            <div className="text-center text-white/72">
              {copy.generating}
              {hasKnownProgress ? (
                <span className="ml-1 font-bold text-white/88">
                  {Math.min(99, Math.round(progressValue * 100))}%
                </span>
              ) : null}
            </div>
          </div>
        ) : status === 'error' ? (
          <div className="absolute inset-0 flex items-center justify-center px-5 text-center text-[12px] leading-5 text-[#f5c76a]">
            {node.data.error ?? copy.failed}
          </div>
        ) : (
          <EmptyPreview copy={copy} />
        )}
        {isBusy ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/[0.06]">
            <div
              className="lumen-node-progress-bar h-full rounded-r-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        ) : status === 'idle' ? (
          <div className="lumen-node-idle-shimmer absolute inset-x-0 bottom-0 h-1" />
        ) : null}
      </div>
    </div>
  );
}

function EmptyPreview({ copy }: { copy: ReturnType<typeof getCopy> }) {
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(145deg,#14181d,#090b0d)] text-[12px] text-white/32">
      {copy.waiting}
    </div>
  );
}

function InfoBlock({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[16px] bg-white/[0.045] p-4 ring-1 ring-white/[0.08]">
      <div className="mb-3 text-[13px] font-bold text-white">{title}</div>
      <div className="space-y-2">{children}</div>
    </div>
  );
}

function InfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[86px_minmax(0,1fr)] gap-3 text-[12px] leading-5">
      <div className="text-white/36">{label}</div>
      <div className="min-w-0 text-white/70">{value}</div>
    </div>
  );
}

function EditableList({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="block">
      <span className="text-[12px] font-bold text-white/62">{label}</span>
      <textarea
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 h-28 w-full resize-none rounded-xl bg-white/[0.06] px-3 py-2 text-[12px] leading-5 text-white outline-none ring-1 ring-white/[0.08] focus:ring-[#79e4ff]/35"
      />
    </label>
  );
}

function PrimaryButton({
  children,
  onClick,
  disabled,
}: {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex h-11 items-center justify-center gap-2 rounded-xl bg-white px-5 text-[13px] font-bold text-[#111315] transition-transform active:scale-[0.98] disabled:cursor-not-allowed disabled:bg-white/[0.08] disabled:text-white/38"
    >
      {children}
    </button>
  );
}

function StatusPill({ status }: { status: NodeStatus }) {
  return (
    <span
      className={cn(
        'rounded-full px-3 py-1.5 text-[11px] font-bold ring-1',
        status === 'success' && 'bg-[#4ade80]/12 text-[#86efac] ring-[#4ade80]/20',
        (status === 'queued' || status === 'running') &&
          'bg-[#79e4ff]/12 text-[#79e4ff] ring-[#79e4ff]/20',
        status === 'error' && 'bg-[#f5c76a]/12 text-[#f5c76a] ring-[#f5c76a]/20',
        status === 'cancelled' && 'bg-white/[0.08] text-white/52 ring-white/[0.12]',
        status === 'idle' && 'bg-white/[0.06] text-white/42 ring-white/[0.08]',
      )}
    >
      {status}
    </span>
  );
}

function StatusDot({ status }: { status: NodeStatus }) {
  return (
    <span
      className={cn(
        'h-2.5 w-2.5 rounded-full',
        status === 'success' && 'bg-[#86efac]',
        (status === 'queued' || status === 'running') && 'bg-[#79e4ff]',
        status === 'error' && 'bg-[#f5c76a]',
        status === 'cancelled' && 'bg-white/38',
        status === 'idle' && 'bg-white/18',
      )}
    />
  );
}

function readNodeOutput(node?: LumenCanvasNode): string | null {
  const output = node?.data.output;
  return typeof output === 'string' && output.trim() ? output.trim() : null;
}

function aggregateStatus(ids: string[], nodeById: Map<string, LumenCanvasNode>): NodeStatus {
  const statuses = ids.map((id) => nodeById.get(id)?.data.status ?? 'idle');
  if (statuses.some((status) => status === 'error')) return 'error';
  if (statuses.some((status) => status === 'queued' || status === 'running')) return 'running';
  if (statuses.some((status) => status === 'cancelled')) return 'cancelled';
  if (statuses.length > 0 && statuses.every((status) => status === 'success')) return 'success';
  return 'idle';
}

function getCopy(locale: 'en' | 'zh') {
  if (locale === 'zh') {
    return {
      back: '返回爆款库',
      inPageWorkflow: '页面内复刻工作流',
      hiddenCanvas: '画布仅后台承载',
      steps: ['拆解', '脚本（门1）', '形象锁定', '分镜图（门2）', '视频+口播', '成片'],
      reference: '参考视频',
      productImages: '商品图',
      breakdownTitle: '参考拆解',
      breakdownDesc:
        '把原爆款拆成 3-6 个可执行场次，包括镜头时间戳、台词和动作；下游生成全部跟着这个骨架走。',
      breakdownReal: '已基于原片视频+音频做多模态拆解',
      breakdownTextOnly:
        '未识别到原片视频文件，下面只是基于标题/标签的文本拆解，建议先在爆款库刷新解析。',
      referenceSignals: '爆款信号',
      remixTargets: '复刻目标',
      hook: '爆点',
      angle: '角度',
      category: '品类',
      region: '地区',
      sellingPoints: '商品卖点',
      audienceTags: '目标受众',
      scene: '场次',
      action: '画面动作',
      line: '字幕',
      voiceLine: '口播台词',
      duration: '时长',
      camera: '运镜',
      language: '口播语言',
      originalTranscript: '原片口播时间轴',
      originalShots: '原片镜头时间轴',
      reviewScript: '查看脚本',
      scriptTitle: '脚本确认（门1）',
      scriptDesc:
        '改脚本/卖点/受众/口播语言；确认后 AI 会按这份脚本重写所有下游分镜、视频、口播 prompt。',
      gate1Hint: '点击下方按钮会让 AI 按你的修改重新规划下游；下游已生成内容会被重置。',
      gate1Loading: '重写下游中...',
      replanFailed: '脚本重算失败，请重试',
      confirmGate1: '确认脚本，重算下游',
      creatorLock: '形象锁定',
      creatorLockDesc: '锁定同一个创作者和同一件产品，后续每一帧都引用这两张锁定图。',
      runCreatorLock: '生成形象锁定',
      nextStoryboard: '进入分镜图',
      storyboardTitle: '分镜图确认（门2）',
      storyboardDesc: '每个场次先出首帧分镜图。单张重跑会自动重置该场次的视频/口播/混音。',
      runStoryboard: '生成全部分镜图',
      rerunOne: '重跑这一张',
      confirmGate2: '确认分镜，进入视频阶段',
      videoTitle: '视频 + 口播 + 混音 + BGM',
      videoDesc: '逐场出 veo 视频、按场次跑 TTS 口播、单片混音把口播盖在视频上，同时生成全片 BGM。',
      sectionScene: '场景视频',
      sectionVoice: '场景口播',
      sectionMix: '场景混音',
      sectionBgm: '全片 BGM',
      runVideos: '生成视频/口播/混音/BGM',
      nextFinal: '进入成片',
      finalTitle: '最终成片',
      finalDesc: '把各场混音串接，叠全片 BGM，统一裁头 0.2s、段间快闪、字幕。',
      runFinal: '生成成片',
      download: '下载',
      generating: '生成中',
      failed: '生成失败',
      waiting: '等待生成',
      saveFailed: '保存进度失败',
    };
  }
  return {
    back: 'Back to library',
    inPageWorkflow: 'In-page remix workflow',
    hiddenCanvas: 'Canvas runs in background',
    steps: [
      'Breakdown',
      'Script (Gate 1)',
      'Identity Lock',
      'Storyboards (Gate 2)',
      'Video + Voice',
      'Final Cut',
    ],
    reference: 'Reference',
    productImages: 'Product images',
    breakdownTitle: 'Reference breakdown',
    breakdownDesc:
      'The reference is split into 3-6 executable scenes (timestamps + dialogue + actions); generation follows this structure.',
    breakdownReal: 'Multimodal breakdown of the actual video (frames + audio)',
    breakdownTextOnly:
      'No original video file detected — breakdown below is text-only (title/tags). Refresh the source video in the library for a real breakdown.',
    referenceSignals: 'Viral signals',
    remixTargets: 'Remix targets',
    hook: 'Hook',
    angle: 'Angle',
    category: 'Category',
    region: 'Region',
    sellingPoints: 'Selling points',
    audienceTags: 'Audience tags',
    scene: 'Scene',
    action: 'Action',
    line: 'Caption',
    voiceLine: 'Voiceover line',
    duration: 'Duration',
    camera: 'Camera',
    language: 'Voice language',
    originalTranscript: 'Original transcript timeline',
    originalShots: 'Original shots timeline',
    reviewScript: 'Review script',
    scriptTitle: 'Script confirmation (Gate 1)',
    scriptDesc:
      'Edit script / selling points / audience / voice language. AI will rewrite all downstream storyboard + video + voice prompts from your version.',
    gate1Hint:
      'Confirming will re-plan everything downstream; any already-generated downstream nodes will be reset.',
    gate1Loading: 'Rewriting downstream...',
    replanFailed: 'Replan failed, please retry',
    confirmGate1: 'Confirm script, replan downstream',
    creatorLock: 'Identity lock',
    creatorLockDesc:
      'Lock one creator and one product so every later frame references the same identities.',
    runCreatorLock: 'Generate locks',
    nextStoryboard: 'Go to storyboards',
    storyboardTitle: 'Storyboard confirmation (Gate 2)',
    storyboardDesc:
      "Generate one first-frame storyboard per scene. Rerunning a frame auto-resets that scene's video / voice / mix.",
    runStoryboard: 'Generate storyboards',
    rerunOne: 'Rerun this frame',
    confirmGate2: 'Confirm storyboards, go to video stage',
    videoTitle: 'Video + Voice + Mix + BGM',
    videoDesc:
      'Generate per-scene veo videos, per-scene TTS voiceover, per-scene mix (voice baked over video), and the full-film BGM.',
    sectionScene: 'Scene videos',
    sectionVoice: 'Scene voiceover',
    sectionMix: 'Scene mix',
    sectionBgm: 'Full-film BGM',
    runVideos: 'Generate videos / voice / mix / BGM',
    nextFinal: 'Go to final cut',
    finalTitle: 'Final cut',
    finalDesc:
      'Concat the per-scene mixes, overlay BGM, unified 0.2s trim + flash transitions + subtitles.',
    runFinal: 'Generate final cut',
    download: 'Download',
    generating: 'Generating',
    failed: 'Generation failed',
    waiting: 'Waiting',
    saveFailed: 'Failed to save progress',
  };
}
