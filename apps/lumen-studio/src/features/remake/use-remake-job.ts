'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';

import type { Locale } from '@/i18n/routing';
import { readClientApiJson } from '@/lib/read-api-json';
import type {
  RemakeJobRecord,
  RemakeStageName,
  RemakeStageStatus,
  RemakeTaskRecord,
} from '@lumen/db';

/**
 * 服务不可用（5xx HTML error page / nginx 502 / 部署中等）时的兜底文案。
 * 之前直接 `response.json()` 会裸抛 SyntaxError，UI 上就显示成
 * `Unexpected token '<', "<!DOCTYPE "... is not valid JSON` 这种用户看不懂的报错。
 */
const UNAVAILABLE_MESSAGE: Record<Locale, string> = {
  en: 'Service is temporarily unavailable. Please refresh and try again.',
  zh: '服务暂时不可用，请刷新重试。',
};

/**
 * 爆款复刻 —— 前端 job hook。
 *
 * 把 SSE / HTTP API / 本地 reducer 揉成一个函数。组件传 jobId 进来，就拿到：
 * - view（当前 job + tasks + 推导的 stageStatuses）
 * - 几个 mutate 动作：runStage / confirmGate1 / confirmGate2 / cancel
 * - 这些动作之外的状态变化全靠 SSE 推
 *
 * SSE 事件处理：
 * - task:queued / task:start / task:progress → 就地 patch 对应 task 状态（不重 fetch，UI 流畅）
 * - task:done / task:error / task:cancelled → 就地 patch task，然后异步 refetch 把 job.outputs 拿全
 * - stage:status → 就地 patch stageStatuses
 * - job:updated → 直接 refetch（仅在 create / gate confirm 时由后端发，频次低）
 *
 * 断线重连：浏览器 EventSource 自动带 Last-Event-ID；后端 sse.ts 用 XRANGE 回放历史事件。
 */

export interface RemakeJobView {
  job: RemakeJobRecord;
  tasks: RemakeTaskRecord[];
  stageStatuses: Record<RemakeStageName, RemakeStageStatus>;
}

interface ApiOk<T> {
  ok: true;
  data: T;
}
interface ApiErr {
  ok: false;
  error: { message: string; status?: number };
}
type ApiResp<T> = ApiOk<T> | ApiErr;

interface OptimisticRun {
  key: string;
  jobId: string;
  stage: RemakeStageName;
  sliceKeys?: string[];
  at: string;
}

type State =
  | { phase: 'loading'; view: null; error: null }
  | { phase: 'ready'; view: RemakeJobView; error: string | null }
  | { phase: 'error'; view: null; error: string };

type Action =
  | { type: 'load:success'; view: RemakeJobView }
  | { type: 'load:error'; error: string }
  | { type: 'set-view'; view: RemakeJobView }
  | {
      type: 'run:optimistic';
      jobId: string;
      stage: RemakeStageName;
      sliceKeys?: string[];
      at: string;
    }
  | { type: 'patch-task'; task: Partial<RemakeTaskRecord> & { id: string; sliceKey: string } }
  | { type: 'patch-stage'; stage: RemakeStageName; status: RemakeStageStatus }
  | { type: 'set-error'; error: string | null };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'load:success':
      return { phase: 'ready', view: action.view, error: null };
    case 'load:error':
      return state.view
        ? { phase: 'ready', view: state.view, error: action.error }
        : { phase: 'error', view: null, error: action.error };
    case 'set-view':
      return { phase: 'ready', view: action.view, error: null };
    case 'run:optimistic': {
      if (!state.view) return state;
      const sliceKeys = resolveRunSliceKeys(state.view.job, action.stage, action.sliceKeys);
      if (sliceKeys.length === 0) return state;
      let tasks = state.view.tasks;
      for (const sliceKey of sliceKeys) {
        const existing = tasks.find((task) => task.sliceKey === sliceKey);
        tasks = patchOrAppendTask(
          tasks,
          buildOptimisticTask({
            existing,
            jobId: action.jobId,
            stage: action.stage,
            sliceKey,
            at: action.at,
          }),
        );
      }
      return {
        ...state,
        view: {
          ...state.view,
          job: clearOutputsForRun(state.view.job, sliceKeys),
          tasks,
          stageStatuses: { ...state.view.stageStatuses, [action.stage]: 'running' },
        },
      };
    }
    case 'patch-task': {
      if (!state.view) return state;
      const tasks = patchOrAppendTask(state.view.tasks, action.task);
      return {
        ...state,
        view: { ...state.view, tasks },
      };
    }
    case 'patch-stage': {
      if (!state.view) return state;
      return {
        ...state,
        view: {
          ...state.view,
          stageStatuses: { ...state.view.stageStatuses, [action.stage]: action.status },
        },
      };
    }
    case 'set-error':
      return state.view
        ? { ...state, error: action.error ?? null }
        : action.error
          ? { phase: 'error', view: null, error: action.error }
          : state;
    default:
      return state;
  }
}

function patchOrAppendTask(
  existing: RemakeTaskRecord[],
  patch: Partial<RemakeTaskRecord> & { id: string; sliceKey: string },
): RemakeTaskRecord[] {
  const idx = existing.findIndex((t) => t.id === patch.id || t.sliceKey === patch.sliceKey);
  if (idx < 0) {
    // 服务端先发 task:queued / task:start 来了，但本地还没拉到这个 task 完整对象。
    // 用一个最小骨架占位，refetch 后会被替换成真实记录。
    return [
      ...existing,
      {
        jobId: '',
        stage: 'lock',
        handler: 'nano-banana2',
        status: 'queued',
        progress: 0,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...patch,
      } as RemakeTaskRecord,
    ];
  }
  const next = [...existing];
  next[idx] = { ...next[idx]!, ...patch, updatedAt: new Date().toISOString() };
  return next;
}

function resolveRunSliceKeys(
  job: RemakeJobRecord,
  stage: RemakeStageName,
  sliceKeys?: string[],
): string[] {
  if (sliceKeys?.length) return [...new Set(sliceKeys)];
  if (stage === 'lock') {
    return [
      RemakeSliceKeys.creatorLock,
      RemakeSliceKeys.productLock,
      ...job.plan.environments.map((environment) =>
        RemakeSliceKeys.environmentLock(environment.index),
      ),
    ];
  }
  if (stage === 'storyboard') {
    return job.plan.scenes.map((scene) => RemakeSliceKeys.sceneImage(scene.index));
  }
  if (stage === 'video') {
    return [
      ...job.plan.scenes.map((scene) => RemakeSliceKeys.sceneVideo(scene.index)),
      RemakeSliceKeys.bgm,
    ];
  }
  if (stage === 'final') return [RemakeSliceKeys.final];
  return [];
}

function buildOptimisticTask(input: {
  existing?: RemakeTaskRecord;
  jobId: string;
  stage: RemakeStageName;
  sliceKey: string;
  at: string;
}): Partial<RemakeTaskRecord> & { id: string; sliceKey: string } {
  return {
    id: input.existing?.id ?? `optimistic-${input.sliceKey}`,
    jobId: input.jobId,
    stage: input.stage,
    sliceKey: input.sliceKey,
    handler: inferOptimisticHandler(input.stage, input.sliceKey),
    status: 'queued',
    progress: 0,
    outputUrl: undefined,
    outputKind: undefined,
    error: undefined,
    settledAt: undefined,
    createdAt: input.existing?.createdAt ?? input.at,
    updatedAt: input.at,
  };
}

function inferOptimisticHandler(
  stage: RemakeStageName,
  sliceKey: string,
): RemakeTaskRecord['handler'] {
  if (stage === 'video') return sliceKey === RemakeSliceKeys.bgm ? 'suno-music' : 'veo-3.1';
  if (stage === 'final') return 'lumen-video-edit';
  return 'nano-banana2';
}

function clearOutputsForRun(job: RemakeJobRecord, sliceKeys: string[]): RemakeJobRecord {
  const outputs: RemakeJobRecord['outputs'] = {
    ...job.outputs,
    scenes: job.outputs.scenes.map((scene) => ({ ...scene })),
    environmentLocks: job.outputs.environmentLocks.map((environment) => ({ ...environment })),
  };

  if (
    sliceKeys.some(
      (sliceKey) => sliceKey.startsWith('scene-video-') || sliceKey === RemakeSliceKeys.bgm,
    )
  ) {
    outputs.finalUrl = undefined;
  }

  for (const sliceKey of sliceKeys) {
    if (sliceKey === RemakeSliceKeys.creatorLock) {
      outputs.creatorLockUrl = undefined;
    } else if (sliceKey === RemakeSliceKeys.productLock) {
      outputs.productLockUrl = undefined;
    } else if (sliceKey === RemakeSliceKeys.bgm) {
      outputs.bgmUrl = undefined;
    } else if (sliceKey === RemakeSliceKeys.final) {
      outputs.finalUrl = undefined;
    } else if (sliceKey.startsWith('environment-lock-')) {
      const environmentIndex = readTrailingIndex(sliceKey);
      if (environmentIndex !== null) {
        const output = outputs.environmentLocks.find(
          (item) => item.environmentIndex === environmentIndex,
        );
        if (output) output.imageUrl = undefined;
      }
    } else if (sliceKey.startsWith('scene-image-')) {
      clearSceneOutput(outputs.scenes, sliceKey, 'imageUrl');
    } else if (sliceKey.startsWith('scene-video-')) {
      clearSceneOutput(outputs.scenes, sliceKey, 'videoUrl');
    } else if (sliceKey.startsWith('scene-voice-')) {
      clearSceneOutput(outputs.scenes, sliceKey, 'voiceUrl');
    } else if (sliceKey.startsWith('scene-mix-')) {
      clearSceneOutput(outputs.scenes, sliceKey, 'mixUrl');
    }
  }

  return { ...job, outputs };
}

function applyOptimisticRuns(view: RemakeJobView, runs: OptimisticRun[]): RemakeJobView {
  let next = view;
  for (const run of runs) {
    if (next.job.id !== run.jobId) continue;
    const sliceKeys = resolveRunSliceKeys(next.job, run.stage, run.sliceKeys);
    if (sliceKeys.length === 0) continue;

    let tasks = next.tasks;
    for (const sliceKey of sliceKeys) {
      const existing = tasks.find((task) => task.sliceKey === sliceKey);
      tasks = patchOrAppendTask(
        tasks,
        buildOptimisticTask({
          existing,
          jobId: run.jobId,
          stage: run.stage,
          sliceKey,
          at: run.at,
        }),
      );
    }

    next = {
      ...next,
      job: clearOutputsForRun(next.job, sliceKeys),
      tasks,
      stageStatuses: { ...next.stageStatuses, [run.stage]: 'running' },
    };
  }
  return next;
}

function clearSceneOutput(
  scenes: RemakeJobRecord['outputs']['scenes'],
  sliceKey: string,
  field: 'imageUrl' | 'videoUrl' | 'voiceUrl' | 'mixUrl',
) {
  const sceneIndex = readTrailingIndex(sliceKey);
  if (sceneIndex === null) return;
  const output = scenes.find((scene) => scene.sceneIndex === sceneIndex);
  if (output) output[field] = undefined;
}

function readTrailingIndex(value: string): number | null {
  const raw = value.split('-').at(-1);
  if (!raw) return null;
  const index = Number.parseInt(raw, 10);
  return Number.isFinite(index) && index >= 1 ? index : null;
}

// ============================================================
// Hook
// ============================================================

export interface UseRemakeJobOptions {
  locale: Locale;
}

export interface UseRemakeJobResult {
  state: State;
  /** 强制重新拉一次 job —— 在 mutate API 之后调用，确保拿到 job.outputs 最新值。 */
  refresh: () => Promise<void>;
  runStage: (input: { stage: RemakeStageName; sliceKeys?: string[] }) => Promise<void>;
  updateScene: (input: {
    sceneIndex: number;
    action?: string;
    dialogue?: string;
    voiceLine?: string;
    imagePrompt?: string | null;
    videoPrompt?: string | null;
  }) => Promise<void>;
  /** 编辑 plan 上的全局 prompt 覆盖（lock / bgm / environment）。 */
  updatePlanPrompts: (input: {
    creatorPrompt?: string | null;
    productPrompt?: string | null;
    bgmPrompt?: string | null;
    environmentPrompts?: Array<{ environmentIndex: number; prompt: string | null }>;
  }) => Promise<void>;
  confirmGate1: (input: {
    scriptText: string;
    sellingPoints: string[];
    audienceTags: string[];
    voiceLanguage?: 'zh' | 'en';
  }) => Promise<void>;
  confirmGate2: () => Promise<void>;
  cancel: (reason?: string) => Promise<void>;
}

export function useRemakeJob(
  jobId: string | null,
  options: UseRemakeJobOptions,
): UseRemakeJobResult {
  const { locale } = options;
  const [state, dispatch] = useReducer(reducer, {
    phase: 'loading',
    view: null,
    error: null,
  } satisfies State);

  // 给 fetchView 用：轮询失败时静默吞掉错误，不打扰用户。
  // 用 ref 是为了避免把 state 加进 fetchView 依赖数组 —— 否则每秒 state 变都会
  // 重建 fetchView + 重置 polling interval。
  const stateRef = useRef(state);
  useEffect(() => {
    stateRef.current = state;
  });
  const pendingOptimisticRunsRef = useRef<OptimisticRun[]>([]);

  const fetchView = useCallback(async () => {
    if (!jobId) return;
    try {
      const response = await fetch(`/api/remake/jobs/${jobId}`, {
        headers: { 'x-lumen-locale': locale },
      });
      const payload = await readClientApiJson<ApiResp<RemakeJobView>>(
        response,
        UNAVAILABLE_MESSAGE[locale] ?? UNAVAILABLE_MESSAGE.en,
      );
      if (!response.ok || !payload.ok) {
        dispatch({
          type: 'load:error',
          error: payload.ok ? 'unknown' : payload.error.message,
        });
        return;
      }
      dispatch({
        type: 'load:success',
        view: applyOptimisticRuns(payload.data, pendingOptimisticRunsRef.current),
      });
    } catch (error) {
      // 已经有 view 数据（轮询失败）= 服务短暂抖动，静默重试下一 tick，
      // 不打扰用户。否则刷新一闪一闪的红 banner 体验很糟糕。
      if (stateRef.current.view) {
        console.warn('[remake] poll failed, will retry next tick', error);
        return;
      }
      dispatch({
        type: 'load:error',
        error: error instanceof Error ? error.message : 'failed to load job',
      });
    }
  }, [jobId, locale]);

  // 初次拉 + jobId 变化时重新拉
  useEffect(() => {
    void fetchView();
  }, [fetchView]);

  // 每秒轮询，直到终态或组件卸载。
  // - stateRef 避免把 state 加入依赖数组——否则每次 fetch 更新 state
  //   都会清掉旧 interval 重建新的，节奏不稳定。
  // - document.visibilityState !== 'visible' 时暂停轮询：用户切到别的标签页或
  //   把窗口最小化时，原来还会以 1Hz 拉 /api/remake/jobs/:id（每个 tab 都
  //   会触发一次 mongo getJob + listTasksByJob + 阶段状态推导）。
  //   一个用户开三个 tab + 后台 tab 也照跑，就是 180 req/min/用户。
  //   切回来时立刻 fetch 一次拿最新状态，不要等下一拍。
  useEffect(() => {
    if (!jobId) return;
    if (typeof document === 'undefined') return;

    let id: ReturnType<typeof setInterval> | null = null;

    const tick = () => {
      const s = stateRef.current;
      if (s.phase === 'ready') {
        const { final } = s.view?.stageStatuses ?? {};
        // final:success / error / cancelled 都是终态，停止轮询
        if (final === 'success' || final === 'error' || final === 'cancelled') return;
      }
      void fetchView();
    };

    const start = () => {
      if (id !== null) return;
      id = setInterval(tick, 1000);
    };
    const stop = () => {
      if (id === null) return;
      clearInterval(id);
      id = null;
    };

    const onVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Just came back into view — refresh immediately so the user
        // doesn't see stale state for up to a second.
        void fetchView();
        start();
      } else {
        stop();
      }
    };

    if (document.visibilityState === 'visible') start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [jobId, fetchView]);

  const post = useCallback(
    async <T>(path: string, body: unknown): Promise<RemakeJobView | null> => {
      try {
        const response = await fetch(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-lumen-locale': locale },
          body: JSON.stringify(body),
        });
        const payload = await readClientApiJson<ApiResp<T>>(
          response,
          UNAVAILABLE_MESSAGE[locale] ?? UNAVAILABLE_MESSAGE.en,
        );
        if (!response.ok || !payload.ok) {
          dispatch({
            type: 'set-error',
            error: payload.ok ? 'request failed' : payload.error.message,
          });
          return null;
        }
        // 接口约定返回 RemakeJobView
        const view = payload.data as unknown as RemakeJobView;
        dispatch({
          type: 'set-view',
          view: applyOptimisticRuns(view, pendingOptimisticRunsRef.current),
        });
        return view;
      } catch (error) {
        dispatch({
          type: 'set-error',
          error: error instanceof Error ? error.message : 'request failed',
        });
        return null;
      }
    },
    [locale],
  );

  const patch = useCallback(
    async <T>(path: string, body: unknown): Promise<RemakeJobView | null> => {
      try {
        const response = await fetch(path, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json', 'x-lumen-locale': locale },
          body: JSON.stringify(body),
        });
        const payload = await readClientApiJson<ApiResp<T>>(
          response,
          UNAVAILABLE_MESSAGE[locale] ?? UNAVAILABLE_MESSAGE.en,
        );
        if (!response.ok || !payload.ok) {
          dispatch({
            type: 'set-error',
            error: payload.ok ? 'request failed' : payload.error.message,
          });
          return null;
        }
        const view = payload.data as unknown as RemakeJobView;
        dispatch({
          type: 'set-view',
          view: applyOptimisticRuns(view, pendingOptimisticRunsRef.current),
        });
        return view;
      } catch (error) {
        dispatch({
          type: 'set-error',
          error: error instanceof Error ? error.message : 'request failed',
        });
        return null;
      }
    },
    [locale],
  );

  const runStage = useCallback(
    async (input: { stage: RemakeStageName; sliceKeys?: string[] }) => {
      if (!jobId) return;
      dispatch({ type: 'set-error', error: null });
      const optimisticRun: OptimisticRun = {
        key: `${input.stage}:${input.sliceKeys?.join(',') ?? '*'}:${Date.now()}`,
        jobId,
        stage: input.stage,
        ...(input.sliceKeys ? { sliceKeys: input.sliceKeys } : {}),
        at: new Date().toISOString(),
      };
      pendingOptimisticRunsRef.current = [...pendingOptimisticRunsRef.current, optimisticRun];
      dispatch({
        type: 'run:optimistic',
        jobId: optimisticRun.jobId,
        stage: optimisticRun.stage,
        ...(optimisticRun.sliceKeys ? { sliceKeys: optimisticRun.sliceKeys } : {}),
        at: optimisticRun.at,
      });
      const view = await post(`/api/remake/jobs/${jobId}/run-stage`, {
        stage: input.stage,
        ...(input.sliceKeys ? { sliceKeys: input.sliceKeys } : {}),
      });
      pendingOptimisticRunsRef.current = pendingOptimisticRunsRef.current.filter(
        (run) => run.key !== optimisticRun.key,
      );
      if (view) {
        dispatch({
          type: 'set-view',
          view: applyOptimisticRuns(view, pendingOptimisticRunsRef.current),
        });
      } else {
        await fetchView();
      }
    },
    [fetchView, jobId, post],
  );

  const updateScene = useCallback(
    async (input: {
      sceneIndex: number;
      action?: string;
      dialogue?: string;
      voiceLine?: string;
      imagePrompt?: string | null;
      videoPrompt?: string | null;
    }) => {
      if (!jobId) return;
      dispatch({ type: 'set-error', error: null });
      await patch(`/api/remake/jobs/${jobId}/scenes/${input.sceneIndex}`, {
        ...(input.action !== undefined ? { action: input.action } : {}),
        ...(input.dialogue !== undefined ? { dialogue: input.dialogue } : {}),
        ...(input.voiceLine !== undefined ? { voiceLine: input.voiceLine } : {}),
        ...(input.imagePrompt !== undefined ? { imagePrompt: input.imagePrompt } : {}),
        ...(input.videoPrompt !== undefined ? { videoPrompt: input.videoPrompt } : {}),
      });
    },
    [jobId, patch],
  );

  const updatePlanPrompts = useCallback(
    async (input: {
      creatorPrompt?: string | null;
      productPrompt?: string | null;
      bgmPrompt?: string | null;
      environmentPrompts?: Array<{ environmentIndex: number; prompt: string | null }>;
    }) => {
      if (!jobId) return;
      dispatch({ type: 'set-error', error: null });
      await patch(`/api/remake/jobs/${jobId}/prompts`, {
        ...(input.creatorPrompt !== undefined ? { creatorPrompt: input.creatorPrompt } : {}),
        ...(input.productPrompt !== undefined ? { productPrompt: input.productPrompt } : {}),
        ...(input.bgmPrompt !== undefined ? { bgmPrompt: input.bgmPrompt } : {}),
        ...(input.environmentPrompts ? { environmentPrompts: input.environmentPrompts } : {}),
      });
    },
    [jobId, patch],
  );

  const confirmGate1 = useCallback(
    async (input: {
      scriptText: string;
      sellingPoints: string[];
      audienceTags: string[];
      voiceLanguage?: 'zh' | 'en';
    }) => {
      if (!jobId) return;
      dispatch({ type: 'set-error', error: null });
      await post(`/api/remake/jobs/${jobId}/confirm-gate`, {
        gate: 'gate1',
        scriptText: input.scriptText,
        sellingPoints: input.sellingPoints,
        audienceTags: input.audienceTags,
        ...(input.voiceLanguage ? { voiceLanguage: input.voiceLanguage } : {}),
      });
    },
    [jobId, post],
  );

  const confirmGate2 = useCallback(async () => {
    if (!jobId) return;
    dispatch({ type: 'set-error', error: null });
    await post(`/api/remake/jobs/${jobId}/confirm-gate`, { gate: 'gate2' });
  }, [jobId, post]);

  const cancel = useCallback(
    async (reason?: string) => {
      if (!jobId) return;
      dispatch({ type: 'set-error', error: null });
      await post(`/api/remake/jobs/${jobId}/cancel`, reason ? { reason } : {});
    },
    [jobId, post],
  );

  return {
    state,
    refresh: fetchView,
    runStage,
    updateScene,
    updatePlanPrompts,
    confirmGate1,
    confirmGate2,
    cancel,
  };
}

// ============================================================
// Helpers exported for components
// ============================================================

/** 根据 sliceKey 找到对应 task 记录。 */
export function findTaskBySliceKey(
  tasks: RemakeTaskRecord[],
  sliceKey: string,
): RemakeTaskRecord | undefined {
  return tasks.find((task) => task.sliceKey === sliceKey);
}

/** sliceKey 约定（与 server/remake/stages.ts 保持一致）。 */
export const RemakeSliceKeys = {
  creatorLock: 'creator-lock',
  productLock: 'product-lock',
  environmentLock: (index: number) => `environment-lock-${index}`,
  sceneImage: (index: number) => `scene-image-${index}`,
  sceneVideo: (index: number) => `scene-video-${index}`,
  sceneVoice: (index: number) => `scene-voice-${index}`,
  sceneMix: (index: number) => `scene-mix-${index}`,
  bgm: 'bgm',
  final: 'final-cut',
} as const;
