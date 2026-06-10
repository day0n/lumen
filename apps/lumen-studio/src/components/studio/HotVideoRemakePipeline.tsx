'use client';

import { PipelineStepper } from '@/components/reactbits/PipelineStepper';
import ShinyText from '@/components/reactbits/ShinyText';
import SpotlightCard from '@/components/reactbits/SpotlightCard';
import { StageFade } from '@/components/reactbits/StageFade';
import { ImageZoomButton } from '@/components/studio/remake/ImageZoomButton';
import { PromptOverrideBar } from '@/components/studio/remake/PromptOverrideBar';
import {
  type RemakeJobView,
  RemakeSliceKeys,
  findTaskBySliceKey,
  useRemakeJob,
} from '@/features/remake/use-remake-job';
import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/cn';
import { toHotVideoMediaUrl } from '@/lib/hot-video-media-url';
import type {
  RemakeJobRecord,
  RemakeJobSceneOutput,
  RemakeStageName,
  RemakeStageStatus,
  RemakeTaskRecord,
} from '@lumen/db';
import {
  IconArrowLeft,
  IconCheck,
  IconDownload,
  IconLoader2,
  IconLock,
  IconMusic,
  IconPlayerPlay,
  IconPlayerStopFilled,
  IconRotate,
} from '@tabler/icons-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

/**
 * 爆款复刻 UI Pipeline（v3，job + SSE 架构）。
 *
 * 数据源：useRemakeJob(jobId) → SSE 实时事件 + REST 拉取的 RemakeJobView。
 * 不再依赖隐藏画布、不再走 WebSocket runNodes、不再保存 LumenCanvas 状态。
 *
 * 6 步骤的状态由 server 端 deriveJobStageStatuses 推出来，UI 直接读：
 * - locked   → 灰/不可点
 * - ready    → 可点（白），用户进入触发该 stage
 * - running  → 进度条
 * - success  → 绿对勾，可回看
 * - error / cancelled → 黄/灰，可重试
 */

export function HotVideoRemakePipeline({
  jobId,
  onBack,
}: {
  jobId: string;
  onBack: () => void;
}) {
  const { locale } = useI18n();
  const copy = getCopy(locale);
  const { state, runStage, confirmGate1, confirmGate2, cancel, updatePlanPrompts, updateScene } =
    useRemakeJob(jobId, { locale });

  if (state.phase === 'loading') {
    return (
      <main className="relative z-10 mx-auto flex max-w-[1260px] flex-col items-center justify-center px-6 pb-20 pt-32 text-center text-white/52">
        <IconLoader2 size={28} className="animate-spin" />
        <div className="mt-4 text-[13px]">{copy.loadingJob}</div>
      </main>
    );
  }

  if (state.phase === 'error' || !state.view) {
    return (
      <main className="relative z-10 mx-auto max-w-[1260px] px-6 pb-20 pt-28">
        <button
          type="button"
          onClick={onBack}
          className="flex h-10 items-center gap-2 rounded-xl bg-white/[0.06] px-3 text-[13px] font-semibold text-white/70 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.1] hover:text-white"
        >
          <IconArrowLeft size={16} stroke={2.2} />
          {copy.back}
        </button>
        <div className="mt-6 rounded-[18px] bg-[#f5c76a]/10 p-5 text-[13px] leading-6 text-[#f5c76a] ring-1 ring-[#f5c76a]/20">
          {state.error ?? copy.loadFailed}
        </div>
      </main>
    );
  }

  return (
    <PipelineView
      view={state.view}
      error={state.error}
      copy={copy}
      onBack={onBack}
      onRunStage={runStage}
      onConfirmGate1={confirmGate1}
      onConfirmGate2={confirmGate2}
      onCancel={cancel}
      onUpdatePlanPrompts={updatePlanPrompts}
      onUpdateScene={updateScene}
    />
  );
}

// ============================================================
// 主视图（state.view 一定存在）
// ============================================================

function PipelineView({
  view,
  error,
  copy,
  onBack,
  onRunStage,
  onConfirmGate1,
  onConfirmGate2,
  onCancel,
  onUpdatePlanPrompts,
  onUpdateScene,
}: {
  view: RemakeJobView;
  error: string | null;
  copy: ReturnType<typeof getCopy>;
  onBack: () => void;
  onRunStage: (input: { stage: RemakeStageName; sliceKeys?: string[] }) => Promise<void>;
  onConfirmGate1: (input: {
    scriptText: string;
    sellingPoints: string[];
    audienceTags: string[];
    voiceLanguage?: 'zh' | 'en';
  }) => Promise<void>;
  onConfirmGate2: () => Promise<void>;
  onCancel: (reason?: string) => Promise<void>;
  onUpdatePlanPrompts: (input: {
    creatorPrompt?: string | null;
    productPrompt?: string | null;
    bgmPrompt?: string | null;
    environmentPrompts?: Array<{ environmentIndex: number; prompt: string | null }>;
  }) => Promise<void>;
  onUpdateScene: (input: {
    sceneIndex: number;
    imagePrompt?: string | null;
    videoPrompt?: string | null;
  }) => Promise<void>;
}) {
  const { job, tasks, stageStatuses } = view;
  const [activeStep, setActiveStep] = useState(() => firstNonSuccessStep(stageStatuses, job));
  const activeJobIdRef = useRef(job.id);
  const [stageBusy, setStageBusy] = useState<RemakeStageName | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const anyStageRunning = useMemo(
    () =>
      (['lock', 'storyboard', 'video', 'final'] as RemakeStageName[]).some(
        (name) => stageStatuses[name] === 'running',
      ),
    [stageStatuses],
  );

  // 只在切换到另一个 job 时重置落点；轮询/SSE 状态更新不应覆盖用户手动回看步骤。
  useEffect(() => {
    if (activeJobIdRef.current === job.id) return;
    activeJobIdRef.current = job.id;
    setActiveStep(firstNonSuccessStep(stageStatuses, job));
  }, [job, stageStatuses]);

  const tryGoToStep = useCallback(
    (index: number) => {
      const stage = STEP_TO_STAGE[index];
      const status = stage ? stageStatuses[stage] : 'ready';
      if (status === 'locked') return; // 灰阶不可点
      setActiveStep(index);
    },
    [stageStatuses],
  );

  const handleRunStage = useCallback(
    async (stage: RemakeStageName, sliceKeys?: string[]) => {
      setStageBusy(stage);
      try {
        await onRunStage(sliceKeys ? { stage, sliceKeys } : { stage });
      } finally {
        setStageBusy(null);
      }
    },
    [onRunStage],
  );

  // 自动开跑：进入 lock / storyboard / video / final 步骤且该 stage 处于 ready 状态时，
  // 自动 trigger runStage —— 用户不需要点"生成"按钮。
  // 用 ref 记录已经自动跑过的 (job, stage) 组合，避免 stageStatuses 抖动 / 用户来回切步骤
  // 导致同一 stage 被重复 trigger。已经 success / running / error / cancelled 的不会自动跑。
  const autoRunFiredRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const stage = STEP_TO_STAGE[activeStep];
    if (!stage || !AUTO_RUN_STAGES.has(stage)) return;
    const status = stageStatuses[stage];
    if (status !== 'ready') return;
    const key = `${job.id}:${stage}`;
    if (autoRunFiredRef.current.has(key)) return;
    autoRunFiredRef.current.add(key);
    void handleRunStage(stage);
  }, [activeStep, stageStatuses, handleRunStage, job.id]);

  // job 切换时清空"已自动跑过"记录，让新 job 重新走一遍自动跑。
  useEffect(() => {
    autoRunFiredRef.current = new Set();
  }, []);

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
          <h1 className="truncate text-[22px] font-bold text-white">{job.reference.label}</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {anyStageRunning ? (
            <button
              type="button"
              disabled={cancelling}
              onClick={async () => {
                setCancelling(true);
                try {
                  await onCancel();
                } finally {
                  setCancelling(false);
                }
              }}
              className="flex h-9 items-center gap-1.5 rounded-full bg-[#f5c76a]/12 px-3 text-[12px] font-bold text-[#f5c76a] ring-1 ring-[#f5c76a]/22 transition-colors hover:bg-[#f5c76a]/22 disabled:opacity-55"
            >
              {cancelling ? (
                <IconLoader2 size={13} className="animate-spin" />
              ) : (
                <IconPlayerStopFilled size={12} />
              )}
              {copy.cancelRunning}
            </button>
          ) : null}
          <div className="rounded-full bg-[#79e4ff]/12 px-3 py-1.5 text-[12px] font-semibold text-[#79e4ff] ring-1 ring-[#79e4ff]/20">
            {copy.jobMode}
          </div>
        </div>
      </div>

      <div className="mb-6 rounded-[18px] bg-[#15171a]/82 px-5 py-4 ring-1 ring-white/[0.06]">
        <PipelineStepper
          steps={copy.steps.map((label, index) => ({
            label,
            status: stageStatuses[STEP_TO_STAGE[index]!],
          }))}
          activeStep={activeStep + 1}
          onStepClick={(oneBased) => tryGoToStep(oneBased - 1)}
        />
      </div>

      {error ? (
        <div className="mb-4 mt-2 rounded-xl bg-[#f5c76a]/10 px-4 py-3 text-[12px] leading-5 text-[#f5c76a] ring-1 ring-[#f5c76a]/20">
          {error}
        </div>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-[300px_minmax(0,1fr)]">
        <aside className="space-y-4">
          <ReferencePreview job={job} copy={copy} />
          {job.productImageUrls.length > 0 ? (
            <div className="rounded-[18px] bg-[#15171a]/88 p-4 ring-1 ring-white/[0.08]">
              <div className="text-[13px] font-bold text-white">{copy.productImages}</div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {job.productImageUrls.map((url) => (
                  <img
                    key={url}
                    src={url}
                    alt=""
                    className="aspect-square rounded-xl bg-black object-cover ring-1 ring-white/[0.08]"
                  />
                ))}
              </div>
            </div>
          ) : null}
          {job.creatorImageUrls.length > 0 ? (
            <div className="rounded-[18px] bg-[#15171a]/88 p-4 ring-1 ring-white/[0.08]">
              <div className="text-[13px] font-bold text-white">{copy.creatorImages}</div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {job.creatorImageUrls.map((url) => (
                  <img
                    key={url}
                    src={url}
                    alt=""
                    className="aspect-square rounded-xl bg-black object-cover ring-1 ring-[#9da8ff]/22"
                  />
                ))}
              </div>
            </div>
          ) : null}
          {job.environmentImageUrls.length > 0 ? (
            <div className="rounded-[18px] bg-[#15171a]/88 p-4 ring-1 ring-white/[0.08]">
              <div className="text-[13px] font-bold text-white">{copy.environmentImages}</div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                {job.environmentImageUrls.map((url) => (
                  <img
                    key={url}
                    src={url}
                    alt=""
                    className="aspect-square rounded-xl bg-black object-cover ring-1 ring-[#3ae08a]/22"
                  />
                ))}
              </div>
            </div>
          ) : null}
        </aside>

        <section className="min-h-[640px] rounded-[18px] bg-[#111315]/92 p-5 ring-1 ring-white/[0.08]">
          <StageFade motionKey={activeStep}>
            {activeStep === 0 && (
              <BreakdownStage copy={copy} job={job} onNext={() => setActiveStep(1)} />
            )}
            {activeStep === 1 && (
              <ScriptStage
                copy={copy}
                job={job}
                gateStatus={stageStatuses.script}
                onConfirm={async (input) => {
                  setStageBusy('script');
                  try {
                    await onConfirmGate1(input);
                    setActiveStep(2);
                  } finally {
                    setStageBusy(null);
                  }
                }}
                onNext={() => setActiveStep(2)}
                busy={stageBusy === 'script'}
              />
            )}
            {activeStep === 2 && (
              <LockStage
                copy={copy}
                job={job}
                tasks={tasks}
                status={stageStatuses.lock}
                busy={stageBusy === 'lock'}
                onUpdatePlanPrompts={onUpdatePlanPrompts}
                onRetry={(sliceKeys) => handleRunStage('lock', sliceKeys)}
                onNext={() => setActiveStep(3)}
              />
            )}
            {activeStep === 3 && (
              <StoryboardStage
                copy={copy}
                job={job}
                tasks={tasks}
                status={stageStatuses.storyboard}
                busy={stageBusy === 'storyboard'}
                onUpdateScene={onUpdateScene}
                onRetry={(sliceKeys) => handleRunStage('storyboard', sliceKeys)}
                onRunOne={(sliceKey) => handleRunStage('storyboard', [sliceKey])}
                onNext={async () => {
                  setStageBusy('storyboard');
                  try {
                    await onConfirmGate2();
                    setActiveStep(4);
                  } finally {
                    setStageBusy(null);
                  }
                }}
              />
            )}
            {activeStep === 4 && (
              <VideoStage
                copy={copy}
                job={job}
                tasks={tasks}
                status={stageStatuses.video}
                busy={stageBusy === 'video'}
                onUpdateScene={onUpdateScene}
                onUpdatePlanPrompts={onUpdatePlanPrompts}
                onRetry={(sliceKeys) => handleRunStage('video', sliceKeys)}
                onRunOne={(sliceKey) => handleRunStage('video', [sliceKey])}
                onNext={() => setActiveStep(5)}
              />
            )}
            {activeStep === 5 && (
              <FinalStage
                copy={copy}
                job={job}
                tasks={tasks}
                status={stageStatuses.final}
                busy={stageBusy === 'final'}
                onRetry={(sliceKeys) => handleRunStage('final', sliceKeys)}
              />
            )}
          </StageFade>
        </section>
      </div>
    </main>
  );
}

// ============================================================
// Stepper（基于 stageStatuses 算 locked / ready / running / done）
// ============================================================

const STEP_TO_STAGE: Record<number, RemakeStageName> = {
  0: 'breakdown',
  1: 'script',
  2: 'lock',
  3: 'storyboard',
  4: 'video',
  5: 'final',
};

/**
 * 进入这些 stage 时自动 trigger runStage —— breakdown 已在 job 创建前算完，
 * script 是 Gate1 需要用户手动编辑后确认，所以不走自动跑。
 */
const AUTO_RUN_STAGES = new Set<RemakeStageName>(['lock', 'storyboard', 'video', 'final']);

// ============================================================
// Stage 子组件
// ============================================================

function BreakdownStage({
  copy,
  job,
  onNext,
}: {
  copy: ReturnType<typeof getCopy>;
  job: RemakeJobRecord;
  onNext: () => void;
}) {
  const breakdown = job.breakdown ?? null;
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
          <InfoLine label={copy.hook} value={breakdown?.hook ?? '-'} />
          <InfoLine label={copy.angle} value={breakdown?.angle ?? '-'} />
          <InfoLine label={copy.category} value={job.reference.category ?? '-'} />
          <InfoLine label={copy.region} value={job.reference.region ?? '-'} />
        </InfoBlock>
        <InfoBlock title={copy.remixTargets}>
          <InfoLine label={copy.sellingPoints} value={job.plan.sellingPoints.join(' / ')} />
          <InfoLine label={copy.audienceTags} value={job.plan.audienceTags.join(' / ')} />
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
            {job.plan.scenes.map((scene) => (
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
        <details className="group mt-5 rounded-[16px] bg-white/[0.045] ring-1 ring-white/[0.06]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[12px] font-bold text-white/72 hover:text-white">
            <span>{copy.originalTranscript}</span>
            <span className="text-white/38 transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="space-y-1.5 border-t border-white/[0.06] px-4 py-3">
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
        <details className="group mt-3 rounded-[16px] bg-white/[0.045] ring-1 ring-white/[0.06]">
          <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-3 text-[12px] font-bold text-white/72 hover:text-white">
            <span>{copy.originalShots}</span>
            <span className="text-white/38 transition-transform group-open:rotate-180">▾</span>
          </summary>
          <div className="space-y-2.5 border-t border-white/[0.06] px-4 py-3">
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
                  <div className="text-[11px] text-white/48">{shot.camera}</div>
                  <div className="text-[11px] text-white/56">{shot.visual}</div>
                  {shot.dialogue ? (
                    <div className="mt-0.5 text-[11px] text-[#9da8ff]">「{shot.dialogue}」</div>
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
  job,
  gateStatus,
  busy,
  onConfirm,
  onNext,
}: {
  copy: ReturnType<typeof getCopy>;
  job: RemakeJobRecord;
  gateStatus: RemakeStageStatus;
  busy: boolean;
  onConfirm: (input: {
    scriptText: string;
    sellingPoints: string[];
    audienceTags: string[];
    voiceLanguage?: 'zh' | 'en';
  }) => Promise<void>;
  onNext: () => void;
}) {
  const [scriptText, setScriptText] = useState(job.plan.scriptText);
  const [sellingPointsText, setSellingPointsText] = useState(job.plan.sellingPoints.join('\n'));
  const [audienceTagsText, setAudienceTagsText] = useState(job.plan.audienceTags.join('\n'));
  const [voiceLanguage, setVoiceLanguage] = useState<'zh' | 'en'>(job.settings.language);

  // 当 job.plan 变化（gate1 replan 完成）时，把本地编辑态同步到新值
  useEffect(() => {
    setScriptText(job.plan.scriptText);
    setSellingPointsText(job.plan.sellingPoints.join('\n'));
    setAudienceTagsText(job.plan.audienceTags.join('\n'));
    setVoiceLanguage(job.settings.language);
  }, [job.plan, job.settings.language]);

  const isDone = gateStatus === 'success';

  return (
    <div>
      <StageHeader title={copy.scriptTitle} description={copy.scriptDesc} />
      <div className="mt-5 grid gap-4 lg:grid-cols-[minmax(0,1fr)_280px]">
        <textarea
          value={scriptText}
          onChange={(event) => setScriptText(event.target.value)}
          className="min-h-[430px] resize-none rounded-[16px] bg-white/[0.045] px-4 py-4 text-[13px] leading-6 text-white outline-none ring-1 ring-white/[0.08] focus:ring-[#79e4ff]/35"
        />
        <div className="space-y-4">
          <EditableList
            label={copy.sellingPoints}
            value={sellingPointsText}
            onChange={setSellingPointsText}
          />
          <EditableList
            label={copy.audienceTags}
            value={audienceTagsText}
            onChange={setAudienceTagsText}
          />
          <label className="block">
            <span className="text-[12px] font-bold text-white/62">{copy.language}</span>
            <select
              value={voiceLanguage}
              onChange={(event) => setVoiceLanguage(event.target.value as 'zh' | 'en')}
              className="mt-2 h-11 w-full rounded-xl bg-white/[0.06] px-3 text-[13px] font-semibold text-white outline-none ring-1 ring-white/[0.08]"
            >
              <option className="bg-[#111315] text-white" value="zh">
                {copy.zh}
              </option>
              <option className="bg-[#111315] text-white" value="en">
                {copy.en}
              </option>
            </select>
          </label>
          <div className="rounded-xl bg-[#9da8ff]/8 px-3 py-2.5 text-[11px] leading-5 text-white/62 ring-1 ring-[#9da8ff]/16">
            {copy.gate1Hint}
          </div>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
        {isDone ? (
          <>
            <span className="rounded-full bg-[#3ae08a]/12 px-3 py-1.5 text-[12px] font-bold text-[#3ae08a] ring-1 ring-[#3ae08a]/22">
              {copy.gate1Confirmed}
            </span>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const points = sellingPointsText
                  .split('\n')
                  .map((item) => item.trim())
                  .filter(Boolean);
                const audiences = audienceTagsText
                  .split('\n')
                  .map((item) => item.trim())
                  .filter(Boolean);
                void onConfirm({
                  scriptText,
                  sellingPoints: points,
                  audienceTags: audiences,
                  voiceLanguage,
                });
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-xl bg-white/[0.06] px-4 text-[13px] font-bold text-white/64 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.1] hover:text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? (
                <IconLoader2 size={15} className="animate-spin" />
              ) : (
                <IconRotate size={15} stroke={2.2} />
              )}
              {busy ? copy.gate1Loading : copy.rerunScript}
            </button>
            <PrimaryButton onClick={onNext}>
              <IconCheck size={15} />
              {copy.nextLock}
            </PrimaryButton>
          </>
        ) : (
          <PrimaryButton
            disabled={busy}
            onClick={() => {
              const points = sellingPointsText
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean);
              const audiences = audienceTagsText
                .split('\n')
                .map((item) => item.trim())
                .filter(Boolean);
              void onConfirm({
                scriptText,
                sellingPoints: points,
                audienceTags: audiences,
                voiceLanguage,
              });
            }}
          >
            {busy ? <IconLoader2 size={15} className="animate-spin" /> : <IconCheck size={15} />}
            {busy ? copy.gate1Loading : copy.confirmGate1}
          </PrimaryButton>
        )}
      </div>
    </div>
  );
}

function LockStage({
  copy,
  job,
  tasks,
  status,
  busy,
  onRetry,
  onNext,
  onUpdatePlanPrompts,
}: {
  copy: ReturnType<typeof getCopy>;
  job: RemakeJobRecord;
  tasks: RemakeTaskRecord[];
  status: RemakeStageStatus;
  busy: boolean;
  onRetry: (sliceKeys: string[]) => void;
  onNext: () => void;
  onUpdatePlanPrompts: (input: {
    creatorPrompt?: string | null;
    productPrompt?: string | null;
    bgmPrompt?: string | null;
    environmentPrompts?: Array<{ environmentIndex: number; prompt: string | null }>;
  }) => Promise<void>;
}) {
  return (
    <div>
      <StageHeader title={copy.creatorLock} description={copy.creatorLockDesc} status={status} />
      <StageErrorBanner
        copy={copy}
        status={status}
        tasks={tasks}
        stage="lock"
        busy={busy}
        onRetry={onRetry}
      />
      <div className="mt-5 grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <SlicePreview
            copy={copy}
            title={copy.creatorLockTitle}
            subtitle={copy.creatorLockSubtitle}
            task={findTaskBySliceKey(tasks, RemakeSliceKeys.creatorLock)}
            outputUrl={job.outputs.creatorLockUrl}
            kind="image"
            aspectClassName="aspect-[4/3]"
            objectFit="contain"
            zoomable
            subtitleAction={
              <PromptOverrideBar
                effectivePrompt={
                  job.plan.creatorPrompt ??
                  findTaskBySliceKey(tasks, RemakeSliceKeys.creatorLock)?.inputPrompt ??
                  null
                }
                overrideValue={job.plan.creatorPrompt}
                onSave={(value) => onUpdatePlanPrompts({ creatorPrompt: value })}
                copy={{
                  ...copy.promptBar,
                  title: copy.promptCreatorTitle,
                  subtitle: copy.promptCreatorSub,
                }}
              />
            }
          />
          <RerunButton
            label={copy.rerunOne}
            onClick={() => onRetry([RemakeSliceKeys.creatorLock])}
          />
        </div>
        <div className="space-y-2">
          <SlicePreview
            copy={copy}
            title={copy.productLockTitle}
            subtitle={copy.productLockSubtitle}
            task={findTaskBySliceKey(tasks, RemakeSliceKeys.productLock)}
            outputUrl={job.outputs.productLockUrl}
            kind="image"
            aspectClassName="aspect-[4/3]"
            objectFit="contain"
            zoomable
            subtitleAction={
              <PromptOverrideBar
                effectivePrompt={
                  job.plan.productPrompt ??
                  findTaskBySliceKey(tasks, RemakeSliceKeys.productLock)?.inputPrompt ??
                  null
                }
                overrideValue={job.plan.productPrompt}
                onSave={(value) => onUpdatePlanPrompts({ productPrompt: value })}
                copy={{
                  ...copy.promptBar,
                  title: copy.promptProductTitle,
                  subtitle: copy.promptProductSub,
                }}
              />
            }
          />
          <RerunButton
            label={copy.rerunOne}
            onClick={() => onRetry([RemakeSliceKeys.productLock])}
          />
        </div>
      </div>
      {job.plan.environments.length > 0 ? (
        <div className="mt-4 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {job.plan.environments.map((environment) => (
            <div key={environment.index} className="space-y-2">
              <SlicePreview
                copy={copy}
                title={`${copy.environmentLockTitle} ${environment.index}`}
                subtitle={environment.name}
                task={findTaskBySliceKey(tasks, RemakeSliceKeys.environmentLock(environment.index))}
                outputUrl={
                  job.outputs.environmentLocks.find(
                    (item) => item.environmentIndex === environment.index,
                  )?.imageUrl
                }
                kind="image"
                aspectClassName="aspect-[4/3]"
                objectFit="contain"
                zoomable
                subtitleAction={
                  <PromptOverrideBar
                    effectivePrompt={
                      environment.prompt ??
                      findTaskBySliceKey(tasks, RemakeSliceKeys.environmentLock(environment.index))
                        ?.inputPrompt ??
                      null
                    }
                    overrideValue={environment.prompt}
                    onSave={(value) =>
                      onUpdatePlanPrompts({
                        environmentPrompts: [
                          { environmentIndex: environment.index, prompt: value },
                        ],
                      })
                    }
                    copy={{
                      ...copy.promptBar,
                      title: `${copy.promptEnvTitle} · ${environment.name}`,
                      subtitle: copy.promptEnvSub,
                    }}
                  />
                }
              />
              <RerunButton
                label={copy.rerunOne}
                onClick={() => onRetry([RemakeSliceKeys.environmentLock(environment.index)])}
              />
            </div>
          ))}
        </div>
      ) : null}
      <StageActions status={status} nextLabel={copy.nextStoryboard} onNext={onNext} />
    </div>
  );
}

function StoryboardStage({
  copy,
  job,
  tasks,
  status,
  busy,
  onRetry,
  onRunOne,
  onNext,
  onUpdateScene,
}: {
  copy: ReturnType<typeof getCopy>;
  job: RemakeJobRecord;
  tasks: RemakeTaskRecord[];
  status: RemakeStageStatus;
  busy: boolean;
  onRetry: (sliceKeys: string[]) => void;
  onRunOne: (sliceKey: string) => void;
  onNext: () => void;
  onUpdateScene: (input: {
    sceneIndex: number;
    imagePrompt?: string | null;
    videoPrompt?: string | null;
  }) => Promise<void>;
}) {
  return (
    <div>
      <StageHeader title={copy.storyboardTitle} description={copy.storyboardDesc} status={status} />
      <StageErrorBanner
        copy={copy}
        status={status}
        tasks={tasks}
        stage="storyboard"
        busy={busy}
        onRetry={onRetry}
      />
      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {job.plan.scenes.map((scene, sceneIdx) => {
          const sliceKey = RemakeSliceKeys.sceneImage(scene.index);
          const sceneOutput = findSceneOutput(job.outputs.scenes, scene.index);
          const overrideValue = job.plan.sceneImagePrompts?.[sceneIdx];
          const task = findTaskBySliceKey(tasks, sliceKey);
          const effectivePrompt = overrideValue ?? task?.inputPrompt ?? scene.action ?? null;
          return (
            <div key={sliceKey} className="space-y-2">
              <SlicePreview
                copy={copy}
                title={`${copy.scene} ${scene.index}`}
                subtitle={effectivePrompt ?? undefined}
                task={task}
                outputUrl={sceneOutput?.imageUrl}
                kind="image"
                zoomable
                subtitleAction={
                  <PromptOverrideBar
                    effectivePrompt={effectivePrompt}
                    overrideValue={overrideValue || undefined}
                    onSave={(value) =>
                      onUpdateScene({ sceneIndex: scene.index, imagePrompt: value })
                    }
                    copy={{
                      ...copy.promptBar,
                      title: `${copy.promptSceneImageTitle} · ${copy.scene} ${scene.index}`,
                      subtitle: copy.promptSceneImageSub,
                    }}
                  />
                }
              />
              <RerunButton label={copy.rerunOne} onClick={() => onRunOne(sliceKey)} />
            </div>
          );
        })}
      </div>
      <StageActions status={status} nextLabel={copy.confirmGate2} onNext={onNext} />
    </div>
  );
}

function VideoStage({
  copy,
  job,
  tasks,
  status,
  busy,
  onRetry,
  onRunOne,
  onNext,
  onUpdateScene,
  onUpdatePlanPrompts,
}: {
  copy: ReturnType<typeof getCopy>;
  job: RemakeJobRecord;
  tasks: RemakeTaskRecord[];
  status: RemakeStageStatus;
  busy: boolean;
  onRetry: (sliceKeys: string[]) => void;
  onRunOne: (sliceKey: string) => void;
  onNext: () => void;
  onUpdateScene: (input: {
    sceneIndex: number;
    imagePrompt?: string | null;
    videoPrompt?: string | null;
  }) => Promise<void>;
  onUpdatePlanPrompts: (input: {
    creatorPrompt?: string | null;
    productPrompt?: string | null;
    bgmPrompt?: string | null;
    environmentPrompts?: Array<{ environmentIndex: number; prompt: string | null }>;
  }) => Promise<void>;
}) {
  return (
    <div>
      <StageHeader title={copy.videoTitle} description={copy.videoDesc} status={status} />
      <StageErrorBanner
        copy={copy}
        status={status}
        tasks={tasks}
        stage="video"
        busy={busy}
        onRetry={onRetry}
      />

      <div className="mt-5 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {job.plan.scenes.map((scene, sceneIdx) => {
          const sliceKey = RemakeSliceKeys.sceneVideo(scene.index);
          const sceneOutput = findSceneOutput(job.outputs.scenes, scene.index);
          const overrideValue = job.plan.sceneVideoPrompts?.[sceneIdx];
          const task = findTaskBySliceKey(tasks, sliceKey);
          const effectivePrompt = overrideValue ?? task?.inputPrompt ?? scene.dialogue ?? null;
          return (
            <div key={sliceKey} className="space-y-2">
              <SlicePreview
                copy={copy}
                title={`${copy.scene} ${scene.index}`}
                subtitle={effectivePrompt ?? undefined}
                task={task}
                outputUrl={sceneOutput?.videoUrl}
                kind="video"
                subtitleAction={
                  <PromptOverrideBar
                    effectivePrompt={effectivePrompt}
                    overrideValue={overrideValue || undefined}
                    onSave={(value) =>
                      onUpdateScene({ sceneIndex: scene.index, videoPrompt: value })
                    }
                    copy={{
                      ...copy.promptBar,
                      title: `${copy.promptSceneVideoTitle} · ${copy.scene} ${scene.index}`,
                      subtitle: copy.promptSceneVideoSub,
                    }}
                  />
                }
              />
              <RerunButton label={copy.rerunOne} onClick={() => onRunOne(sliceKey)} />
            </div>
          );
        })}
      </div>

      <Section title={copy.sectionBgm}>
        <div className="space-y-2">
          <SlicePreview
            copy={copy}
            title={copy.sectionBgm}
            subtitle={copy.bgmSubtitle}
            task={findTaskBySliceKey(tasks, RemakeSliceKeys.bgm)}
            outputUrl={job.outputs.bgmUrl}
            kind="audio"
            icon={<IconMusic size={18} />}
            subtitleAction={
              <PromptOverrideBar
                effectivePrompt={
                  job.plan.bgmPrompt ??
                  findTaskBySliceKey(tasks, RemakeSliceKeys.bgm)?.inputPrompt ??
                  null
                }
                overrideValue={job.plan.bgmPrompt}
                onSave={(value) => onUpdatePlanPrompts({ bgmPrompt: value })}
                copy={{
                  ...copy.promptBar,
                  title: copy.promptBgmTitle,
                  subtitle: copy.promptBgmSub,
                }}
              />
            }
          />
          <RerunButton label={copy.rerunOne} onClick={() => onRunOne(RemakeSliceKeys.bgm)} />
        </div>
      </Section>

      <StageActions status={status} nextLabel={copy.nextFinal} onNext={onNext} />
    </div>
  );
}

function FinalStage({
  copy,
  job,
  tasks,
  status,
  busy,
  onRetry,
}: {
  copy: ReturnType<typeof getCopy>;
  job: RemakeJobRecord;
  tasks: RemakeTaskRecord[];
  status: RemakeStageStatus;
  busy: boolean;
  onRetry: (sliceKeys: string[]) => void;
}) {
  const task = findTaskBySliceKey(tasks, RemakeSliceKeys.final);
  const outputUrl = job.outputs.finalUrl ?? task?.outputUrl ?? null;
  return (
    <div>
      <StageHeader title={copy.finalTitle} description={copy.finalDesc} status={status} />
      <StageErrorBanner
        copy={copy}
        status={status}
        tasks={tasks}
        stage="final"
        busy={busy}
        onRetry={onRetry}
      />
      <div className="mt-5">
        <SlicePreview
          copy={copy}
          title={copy.finalTitle}
          task={task}
          outputUrl={outputUrl}
          kind="video"
          className="mx-auto max-w-[360px]"
        />
      </div>
      {outputUrl ? (
        <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
          <a
            href={outputUrl}
            download
            target="_blank"
            rel="noreferrer"
            className="flex h-11 items-center gap-2 rounded-xl bg-white px-4 text-[13px] font-bold text-[#111315] transition-transform active:scale-[0.98]"
          >
            <IconDownload size={15} stroke={2.2} />
            {copy.download}
          </a>
        </div>
      ) : null}
    </div>
  );
}

// ============================================================
// 公用小组件
// ============================================================

function StageHeader({
  title,
  description,
  status,
}: {
  title: string;
  description: string;
  status?: RemakeStageStatus;
}) {
  // 当前活跃 stage 的标题用 ShinyText 扫一道金属光泽，提升存在感；
  // success / locked / error 等终态用普通白字，避免 idle 状态还在扫光浪费 CPU。
  const useShine = status === 'running' || status === 'ready' || status === undefined;
  return (
    <div className="flex flex-wrap items-start gap-3">
      <div className="min-w-0 flex-1">
        <h2 className="text-[20px] font-bold leading-7 text-white">
          {useShine ? (
            <ShinyText text={title} color="#f5f5f5" shineColor="#ffffff" speed={5} spread={120} />
          ) : (
            title
          )}
        </h2>
        <p className="mt-1 text-[13px] leading-6 text-white/42">{description}</p>
      </div>
      {status ? <StatusPill status={status} /> : null}
    </div>
  );
}

/**
 * 右下「进入下一步」——成功后可点击，运行中保留禁用态占位。
 */
function StageActions({
  status,
  nextLabel,
  onNext,
}: {
  status: RemakeStageStatus;
  nextLabel: string;
  onNext: () => void;
}) {
  const visible = status === 'success' || status === 'running';
  if (!visible) return null;
  const disabled = status !== 'success';

  return (
    <div className="mt-5 flex flex-wrap items-center justify-end gap-3">
      <PrimaryButton onClick={onNext} disabled={disabled}>
        <IconCheck size={15} />
        {nextLabel}
      </PrimaryButton>
    </div>
  );
}

/**
 * Stage error 横幅 —— 当 stage status === 'error' 时显示。
 * 列出失败 task 的 error message，并给一个「重试本步骤失败任务」按钮，
 * 调 runStage(stage, sliceKeys=失败 task 列表) 只重跑这些 task。
 */
function StageErrorBanner({
  copy,
  status,
  tasks,
  stage,
  busy,
  onRetry,
}: {
  copy: ReturnType<typeof getCopy>;
  status: RemakeStageStatus;
  tasks: RemakeTaskRecord[];
  stage: RemakeStageName;
  busy: boolean;
  onRetry: (sliceKeys: string[]) => void;
}) {
  if (status !== 'error') return null;
  const failedTasks = tasks.filter((task) => task.stage === stage && task.status === 'error');
  if (!failedTasks.length) return null;

  return (
    <div className="mt-4 rounded-[16px] bg-[#f5c76a]/8 px-4 py-3 ring-1 ring-[#f5c76a]/22">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[12px] font-bold uppercase tracking-wide text-[#f5c76a]">
            {copy.stageErrorTitle}
          </div>
          <div className="mt-1 text-[12px] leading-5 text-white/72">
            {copy.stageErrorSummary.replace('{count}', String(failedTasks.length))}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onRetry(failedTasks.map((task) => task.sliceKey))}
          disabled={busy}
          className="flex h-9 shrink-0 items-center gap-1.5 rounded-xl bg-[#f5c76a]/14 px-3 text-[12px] font-bold text-[#f5c76a] ring-1 ring-[#f5c76a]/24 transition-colors hover:bg-[#f5c76a]/22 disabled:cursor-wait disabled:opacity-55"
        >
          {busy ? (
            <IconLoader2 size={13} className="animate-spin" />
          ) : (
            <IconRotate size={13} stroke={2.4} />
          )}
          {copy.stageErrorRetry}
        </button>
      </div>
      <ul className="mt-3 space-y-1.5 text-[11px] leading-4 text-white/56">
        {failedTasks.slice(0, 6).map((task) => (
          <li key={task.sliceKey} className="grid grid-cols-[140px_minmax(0,1fr)] gap-2">
            <span className="truncate font-mono text-white/40">{task.sliceKey}</span>
            <span className="truncate text-white/64">
              {task.error?.trim() || copy.stageErrorUnknown}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="mt-5">
      <div className="mb-2 text-[12px] font-bold uppercase tracking-wide text-white/40">
        {title}
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{children}</div>
    </div>
  );
}

// 每个节点都可独立重跑：不因同阶段其他节点正在生成而禁用。
function RerunButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-white/[0.06] text-[12px] font-bold text-white/58 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.1] hover:text-white"
    >
      <IconRotate size={13} stroke={2.2} />
      {label}
    </button>
  );
}

function SlicePreview({
  copy,
  title,
  subtitle,
  subtitleAction,
  task,
  outputUrl,
  kind,
  icon,
  className,
  aspectClassName = 'aspect-[9/16]',
  objectFit = 'cover',
  zoomable = false,
}: {
  copy: ReturnType<typeof getCopy>;
  title: string;
  subtitle?: string;
  /** subtitle 区域右下角的小操作槽（当前用于挂 PromptOverrideBar 的铅笔按钮）。 */
  subtitleAction?: ReactNode;
  task?: RemakeTaskRecord;
  outputUrl?: string | null;
  kind: 'image' | 'video' | 'audio';
  icon?: ReactNode;
  className?: string;
  /**
   * 媒体框宽高比。默认 `aspect-[9/16]`（竖屏视频/分镜首帧）。
   * lock 类参考表通常是横向多面板，传 `aspect-[4/3]` 或 `aspect-[3/2]` 更省空间。
   */
  aspectClassName?: string;
  /** 媒体 object-fit，默认 cover；横向参考表用 contain 才不会被裁掉左右两边。 */
  objectFit?: 'cover' | 'contain';
  /** 是否在 image 卡片右上角显示放大按钮 + 点击全屏看大图。仅 kind='image' 有效。 */
  zoomable?: boolean;
}) {
  const status = task?.status ?? 'queued';
  const isBusy = status === 'queued' || status === 'running';
  const rawProgress = task?.progress ?? 0;
  const progressPercent = Math.max(isBusy ? 14 : 0, Math.round(rawProgress * 100));
  return (
    <SpotlightCard
      className={cn('rounded-[16px] bg-white/[0.045] ring-1 ring-white/[0.08]', className)}
      spotlightColor="rgba(121, 228, 255, 0.15)"
    >
      <div className="flex h-10 items-center gap-2 border-b border-white/[0.06] px-3">
        <span className="text-white/48">{icon}</span>
        <div className="min-w-0 flex-1 truncate text-[12px] font-bold text-white/74">{title}</div>
        <StatusDot status={status} />
      </div>
      <div className={cn('relative bg-black/52', aspectClassName)}>
        {outputUrl ? (
          kind === 'image' ? (
            <>
              <img
                src={outputUrl}
                alt=""
                className={cn(
                  'absolute inset-0 h-full w-full',
                  objectFit === 'contain' ? 'object-contain' : 'object-cover',
                )}
              />
              {zoomable ? (
                <ImageZoomButton
                  src={outputUrl}
                  alt={title}
                  caption={subtitle ?? title}
                  className="absolute right-2 top-2 z-20"
                />
              ) : null}
            </>
          ) : kind === 'video' ? (
            // biome-ignore lint/a11y/useMediaCaption: Generated preview media has no WebVTT track.
            <video
              src={outputUrl}
              controls
              playsInline
              className="absolute inset-0 h-full w-full object-contain"
            />
          ) : (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-5 text-center">
              <IconMusic size={34} className="text-[#79e4ff]" stroke={1.8} />
              {/* biome-ignore lint/a11y/useMediaCaption: Generated audio previews have no caption track. */}
              <audio src={outputUrl} controls className="w-full" />
            </div>
          )
        ) : isBusy ? (
          <div className="absolute inset-0 overflow-hidden">
            <div className="absolute inset-0 bg-[linear-gradient(145deg,#16181c,#0b0c0e)]" />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-5 text-center">
              <IconLoader2 size={26} stroke={2} className="animate-spin text-white/70" />
              <div className="text-[13px] font-semibold tracking-wide text-white/64">
                {copy.generating}...
              </div>
              {rawProgress > 0 ? (
                <div className="text-[12px] font-bold text-white/52">
                  {Math.min(99, Math.round(rawProgress * 100))}%
                </div>
              ) : null}
            </div>
          </div>
        ) : status === 'error' ? (
          <div className="absolute inset-0 flex items-center justify-center px-5 text-center text-[12px] leading-5 text-[#f5c76a]">
            {task?.error ?? copy.failed}
          </div>
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-[linear-gradient(145deg,#14181d,#090b0d)] text-[12px] text-white/32">
            {copy.waiting}
          </div>
        )}
        {isBusy ? (
          <div className="absolute inset-x-0 bottom-0 h-1 bg-white/[0.06]">
            <div
              className="lumen-node-progress-bar h-full rounded-r-full transition-all duration-300"
              style={{ width: `${progressPercent}%` }}
            />
          </div>
        ) : null}
      </div>
      {subtitle || subtitleAction ? (
        <div className="relative border-t border-white/[0.06] px-3 py-2 text-[11px] leading-4 text-white/52">
          {subtitle ? (
            <div className={cn('line-clamp-4 break-words', subtitleAction && 'pr-9')}>
              {subtitle}
            </div>
          ) : (
            // 没 subtitle 文本时也撑一行高度，让铅笔按钮有挂靠区域
            <div aria-hidden className="h-5" />
          )}
          {subtitleAction ? (
            <div className="absolute bottom-1.5 right-1.5">{subtitleAction}</div>
          ) : null}
        </div>
      ) : null}
    </SpotlightCard>
  );
}

function ReferencePreview({
  job,
  copy,
}: {
  job: RemakeJobRecord;
  copy: ReturnType<typeof getCopy>;
}) {
  const { reference } = job;
  const previewUrl = toHotVideoMediaUrl(reference.previewUrl);
  return (
    <div className="overflow-hidden rounded-[18px] bg-[#15171a]/88 ring-1 ring-white/[0.08]">
      <div className="relative aspect-[9/16] bg-black">
        {previewUrl ? (
          <video
            src={previewUrl}
            poster={reference.thumbnailUrl}
            autoPlay
            muted
            loop
            playsInline
            controls
            className="absolute inset-0 h-full w-full object-cover"
          >
            <track kind="captions" />
          </video>
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

function StatusPill({ status }: { status: RemakeStageStatus }) {
  return (
    <span
      className={cn(
        'rounded-full px-3 py-1.5 text-[11px] font-bold ring-1',
        status === 'success' && 'bg-[#4ade80]/12 text-[#86efac] ring-[#4ade80]/20',
        status === 'running' && 'bg-[#79e4ff]/12 text-[#79e4ff] ring-[#79e4ff]/20',
        status === 'error' && 'bg-[#f5c76a]/12 text-[#f5c76a] ring-[#f5c76a]/20',
        status === 'cancelled' && 'bg-white/[0.08] text-white/52 ring-white/[0.12]',
        status === 'locked' && 'bg-white/[0.04] text-white/32 ring-white/[0.06]',
        status === 'ready' && 'bg-white/[0.06] text-white/42 ring-white/[0.08]',
      )}
    >
      {status}
    </span>
  );
}

function StatusDot({ status }: { status: string }) {
  return (
    <span
      className={cn(
        'h-2.5 w-2.5 rounded-full',
        status === 'success' && 'bg-[#86efac]',
        (status === 'queued' || status === 'running') && 'bg-[#79e4ff]',
        status === 'error' && 'bg-[#f5c76a]',
        status === 'cancelled' && 'bg-white/38',
      )}
    />
  );
}

// ============================================================
// 工具：scene index → 找对应 output
// ============================================================

function findSceneOutput(
  scenes: RemakeJobSceneOutput[],
  sceneIndex: number,
): RemakeJobSceneOutput | undefined {
  return scenes.find((s) => s.sceneIndex === sceneIndex);
}

/**
 * 从 stageStatuses 推导用户首次进入 Pipeline 时应停在哪一步。
 * 规则：找第一个 status !== success 的步骤；都过了就停在最后一步（成片）。
 */
function firstNonSuccessStep(
  stageStatuses: Record<RemakeStageName, RemakeStageStatus>,
  job: RemakeJobRecord,
): number {
  const stages: RemakeStageName[] = ['breakdown', 'script', 'lock', 'storyboard', 'video', 'final'];
  // 用户第一次进入时未确认 gate1，script 应停在 step 1
  if (!job.gate1ConfirmedAt) {
    return stageStatuses.breakdown === 'success' ? 1 : 0;
  }
  for (let i = 2; i < stages.length; i += 1) {
    const status = stageStatuses[stages[i]!];
    if (status !== 'success') return i;
  }
  return stages.length - 1;
}

// ============================================================
// 文案
// ============================================================

function getCopy(locale: 'en' | 'zh') {
  if (locale === 'zh') {
    return {
      back: '返回爆款库',
      inPageWorkflow: '页面内复刻工作流',
      jobMode: '任务模式（可断点续传）',
      cancelRunning: '取消任务',
      reference: '参考视频',
      productImages: '商品图',
      creatorImages: '创作者参考',
      environmentImages: '场景参考',
      steps: ['拆解', '脚本（门1）', '形象锁定', '分镜图（门2）', '视频+口播', '成片'],
      breakdownTitle: '参考拆解',
      breakdownDesc: '把原爆款拆成 3-6 个可执行场次，包括镜头时间戳、台词和动作。',
      breakdownReal: '已基于原片视频+音频做多模态拆解',
      breakdownTextOnly: '未识别到原片视频文件，下面只是基于标题/标签的文本拆解。',
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
      voiceLine: '口播台词',
      duration: '时长',
      language: '口播语言',
      zh: '中文',
      en: 'English',
      originalTranscript: '原片口播时间轴',
      originalShots: '原片镜头时间轴',
      reviewScript: '查看脚本',
      scriptTitle: '脚本确认（门1）',
      scriptDesc: '改脚本/卖点/受众/口播语言；确认后 AI 会按这份脚本重写所有下游 prompt。',
      gate1Hint: '点击下方按钮会让 AI 按你的修改重新规划下游；下游已生成内容会被重置。',
      gate1Loading: '重写下游中...',
      gate1Confirmed: '脚本已确认',
      confirmGate1: '确认脚本，重算下游',
      rerunScript: '重跑脚本',
      nextLock: '进入形象锁定',
      creatorLock: '形象锁定',
      creatorLockDesc: '锁定同一个创作者、产品和场景环境，后续每一帧都引用这些锁定图。',
      creatorLockTitle: '创作者定妆照',
      productLockTitle: '产品多视图',
      environmentLockTitle: '场景环境锁定',
      runCreatorLock: '生成形象锁定',
      nextStoryboard: '进入分镜图',
      storyboardTitle: '分镜图确认（门2）',
      storyboardDesc: '每个场次先出首帧分镜图。单张重跑会自动重置该场次的视频/口播/混音。',
      runStoryboard: '生成全部分镜图',
      rerunOne: '重跑这一张',
      confirmGate2: '确认分镜，进入视频阶段',
      videoTitle: '视频 + 口播 + 混音 + BGM',
      videoDesc: '逐场生成 veo 视频；单场失败可点「重跑这一张」，无需回到脚本步骤。',
      sectionScene: '场景视频',
      sectionVoice: '场景口播',
      sectionMix: '场景混音',
      sectionBgm: '全片 BGM',
      runVideos: '生成视频/口播/混音/BGM',
      nextFinal: '进入成片',
      finalTitle: '最终成片',
      finalDesc: '拼接所有场景混音，叠 BGM，统一裁头 0.2s、段间快闪、统一字幕。',
      runFinal: '生成成片',
      download: '下载',
      generating: '生成中',
      stageRunningHint: '正在生成，预览区会显示进度',
      failed: '生成失败',
      waiting: '等待生成',
      loadingJob: '加载复刻任务中...',
      loadFailed: '加载失败',
      promptBar: {
        label: 'Prompt',
        placeholder:
          '该步骤还没有真实生效的 prompt（任务跑过后会自动同步进来）。你也可以现在就写一段自定义 prompt。',
        hint: '保存后下次重跑该步骤会使用此 prompt；清空再保存可恢复自动生成。运行中也可随时修改。',
        save: '保存',
        cancel: '取消',
        reset: '恢复自动',
        saving: '保存中',
        disabledTooltip: '当前步骤正在运行或被锁定，请稍后再编辑',
        editTooltip: '编辑 prompt',
      },
      promptCreatorTitle: '创作者锁定 · Prompt',
      promptCreatorSub: '控制创作者多视图参考表的画法（face / pose / outfit 锁定）',
      promptProductTitle: '商品锁定 · Prompt',
      promptProductSub: '控制商品多视图参考表（包装 / 材质 / 颜色锁定）',
      promptEnvTitle: '场景锁定 · Prompt',
      promptEnvSub: '控制可复用环境参考图的画法（空间 / 光线 / 机位）',
      promptSceneImageTitle: '分镜首帧 · Prompt',
      promptSceneImageSub: '控制该场首帧画面构图、相机、动作摆位',
      promptSceneVideoTitle: '视频 + 口播 · Prompt',
      promptSceneVideoSub: '控制该场运动 / 相机推拉 / 口播台词 / 嘴型',
      promptBgmTitle: 'BGM · Prompt',
      promptBgmSub: '控制全片 BGM 的风格、节奏、时长',
      creatorLockSubtitle: '锁定创作者多视图参考表（face / pose / outfit）',
      productLockSubtitle: '锁定商品多视图参考表（包装 / 材质 / 颜色）',
      bgmSubtitle: '全片器乐 BGM',
      autoRunning: '生成中…',
      stageErrorTitle: '本步骤生成失败',
      stageErrorSummary: '本步骤有 {count} 个任务失败。点右侧按钮重试这些失败任务。',
      stageErrorRetry: '重试失败任务',
      stageErrorUnknown: '未知错误',
    };
  }
  return {
    back: 'Back to library',
    inPageWorkflow: 'In-page remix workflow',
    jobMode: 'Job mode (resumable)',
    cancelRunning: 'Cancel running',
    reference: 'Reference',
    productImages: 'Product images',
    creatorImages: 'Creator references',
    environmentImages: 'Scene references',
    steps: [
      'Breakdown',
      'Script (Gate 1)',
      'Identity Lock',
      'Storyboards (Gate 2)',
      'Video + Voice',
      'Final Cut',
    ],
    breakdownTitle: 'Reference breakdown',
    breakdownDesc:
      'The reference is split into 3-6 executable scenes with timestamps, dialogue, and actions.',
    breakdownReal: 'Multimodal breakdown from the actual video (frames + audio)',
    breakdownTextOnly:
      'No original video file detected. Breakdown below is text-only (title / tags).',
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
    voiceLine: 'Voiceover line',
    duration: 'Duration',
    language: 'Voice language',
    zh: '中文',
    en: 'English',
    originalTranscript: 'Original transcript timeline',
    originalShots: 'Original shots timeline',
    reviewScript: 'Review script',
    scriptTitle: 'Script confirmation (Gate 1)',
    scriptDesc:
      'Edit script / selling points / audience / voice language. AI will rewrite all downstream prompts.',
    gate1Hint:
      'Confirming will re-plan everything downstream; any already-generated downstream nodes will be reset.',
    gate1Loading: 'Rewriting downstream...',
    gate1Confirmed: 'Script confirmed',
    confirmGate1: 'Confirm script, replan downstream',
    rerunScript: 'Rerun script',
    nextLock: 'Go to identity lock',
    creatorLock: 'Identity lock',
    creatorLockDesc:
      'Lock one creator, one product, and reusable scene environments so every later frame references the same identities.',
    creatorLockTitle: 'Creator reference',
    productLockTitle: 'Product multi-view',
    environmentLockTitle: 'Environment lock',
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
      'Generate per-scene veo videos. Rerun a single scene with the button below if one fails.',
    sectionScene: 'Scene videos',
    sectionVoice: 'Scene voiceover',
    sectionMix: 'Scene mix',
    sectionBgm: 'Full-film BGM',
    runVideos: 'Generate videos / voice / mix / BGM',
    nextFinal: 'Go to final cut',
    finalTitle: 'Final cut',
    finalDesc:
      'Concat per-scene mixes, overlay BGM, unified 0.2s trim + flash transitions + subtitles.',
    runFinal: 'Generate final cut',
    download: 'Download',
    generating: 'Generating',
    failed: 'Generation failed',
    waiting: 'Waiting',
    loadingJob: 'Loading remake job...',
    loadFailed: 'Failed to load',
    promptBar: {
      label: 'Prompt',
      placeholder:
        'No effective prompt yet — it will sync in once the step runs. You can also write a custom prompt now.',
      hint: 'Saved prompt applies on the next rerun of this step. Clear to reset to auto. Editable anytime, even while running.',
      save: 'Save',
      cancel: 'Cancel',
      reset: 'Reset to auto',
      saving: 'Saving',
      disabledTooltip: 'This stage is running or locked. Edit again later.',
      editTooltip: 'Edit prompt',
    },
    promptCreatorTitle: 'Creator lock · Prompt',
    promptCreatorSub: 'Controls how the creator multi-view reference sheet is drawn.',
    promptProductTitle: 'Product lock · Prompt',
    promptProductSub: 'Controls how the product multi-view reference sheet is drawn.',
    promptEnvTitle: 'Environment lock · Prompt',
    promptEnvSub: 'Controls how the reusable environment plate is drawn.',
    promptSceneImageTitle: 'Storyboard keyframe · Prompt',
    promptSceneImageSub:
      'Controls composition, camera, and action placement of this scene’s first frame.',
    promptSceneVideoTitle: 'Video + voiceover · Prompt',
    promptSceneVideoSub:
      'Controls motion, camera movement, spoken line, and lip-sync for this scene.',
    promptBgmTitle: 'BGM · Prompt',
    promptBgmSub: 'Controls full-film BGM style, tempo, and duration.',
    creatorLockSubtitle: 'Creator multi-view reference (face / pose / outfit)',
    productLockSubtitle: 'Product multi-view reference (packaging / material / color)',
    bgmSubtitle: 'Full-film instrumental BGM',
    autoRunning: 'Generating…',
    stageErrorTitle: 'This step failed',
    stageErrorSummary:
      '{count} task(s) failed in this step. Click retry to re-run the failed ones.',
    stageErrorRetry: 'Retry failed tasks',
    stageErrorUnknown: 'Unknown error',
  };
}
