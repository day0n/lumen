'use client';

import { useCallback, useEffect, useReducer, useRef } from 'react';

import type { Locale } from '@/i18n/routing';
import type {
  RemakeJobRecord,
  RemakeStageName,
  RemakeStageStatus,
  RemakeTaskRecord,
  RemakeTaskStatus,
} from '@lumen/db';

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

type State =
  | { phase: 'loading'; view: null; error: null }
  | { phase: 'ready'; view: RemakeJobView; error: string | null }
  | { phase: 'error'; view: null; error: string };

type Action =
  | { type: 'load:success'; view: RemakeJobView }
  | { type: 'load:error'; error: string }
  | { type: 'set-view'; view: RemakeJobView }
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

// ============================================================
// SSE event shape (与 server/remake/dispatch.ts 的 RemakeEvent 对齐)
// ============================================================

type ServerEvent =
  | { type: 'task:queued'; taskId: string; stage: RemakeStageName; sliceKey: string }
  | { type: 'task:start'; taskId: string; stage: RemakeStageName; sliceKey: string }
  | {
      type: 'task:progress';
      taskId: string;
      stage: RemakeStageName;
      sliceKey: string;
      progress: number;
    }
  | {
      type: 'task:done';
      taskId: string;
      stage: RemakeStageName;
      sliceKey: string;
      outputUrl: string;
      outputKind: 'image' | 'video' | 'audio' | 'text';
    }
  | {
      type: 'task:error';
      taskId: string;
      stage: RemakeStageName;
      sliceKey: string;
      error: string;
    }
  | {
      type: 'task:cancelled';
      taskId: string;
      stage: RemakeStageName;
      sliceKey: string;
      reason: string;
    }
  | { type: 'stage:status'; stage: RemakeStageName; status: RemakeStageStatus }
  | { type: 'job:updated' };

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
  // refetch 节流：连续多个事件来时只发起一次实际 fetch
  const refetchPendingRef = useRef(false);

  const fetchView = useCallback(async () => {
    if (!jobId) return;
    try {
      const response = await fetch(`/api/remake/jobs/${jobId}`, {
        headers: { 'x-lumen-locale': locale },
      });
      const payload = (await response.json()) as ApiResp<RemakeJobView>;
      if (!response.ok || !payload.ok) {
        dispatch({
          type: 'load:error',
          error: payload.ok ? 'unknown' : payload.error.message,
        });
        return;
      }
      dispatch({ type: 'load:success', view: payload.data });
    } catch (error) {
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

  // SSE 订阅
  useEffect(() => {
    if (!jobId) return;
    const source = new EventSource(`/api/remake/jobs/${jobId}/stream`);

    const scheduleRefetch = () => {
      if (refetchPendingRef.current) return;
      refetchPendingRef.current = true;
      setTimeout(() => {
        refetchPendingRef.current = false;
        void fetchView();
      }, 350);
    };

    source.onmessage = (event) => {
      let parsed: ServerEvent;
      try {
        parsed = JSON.parse(event.data) as ServerEvent;
      } catch {
        return;
      }
      switch (parsed.type) {
        case 'task:queued':
          dispatch({
            type: 'patch-task',
            task: {
              id: parsed.taskId,
              sliceKey: parsed.sliceKey,
              stage: parsed.stage,
              status: 'queued' as RemakeTaskStatus,
              progress: 0,
              error: undefined,
            },
          });
          break;
        case 'task:start':
          dispatch({
            type: 'patch-task',
            task: {
              id: parsed.taskId,
              sliceKey: parsed.sliceKey,
              stage: parsed.stage,
              status: 'running' as RemakeTaskStatus,
              progress: 0,
            },
          });
          break;
        case 'task:progress':
          dispatch({
            type: 'patch-task',
            task: {
              id: parsed.taskId,
              sliceKey: parsed.sliceKey,
              stage: parsed.stage,
              status: 'running' as RemakeTaskStatus,
              progress: parsed.progress,
            },
          });
          break;
        case 'task:done':
          dispatch({
            type: 'patch-task',
            task: {
              id: parsed.taskId,
              sliceKey: parsed.sliceKey,
              stage: parsed.stage,
              status: 'success' as RemakeTaskStatus,
              progress: 1,
              outputUrl: parsed.outputUrl,
              outputKind: parsed.outputKind,
            },
          });
          // job.outputs 在 server 端已经写好，refetch 拿全。
          scheduleRefetch();
          break;
        case 'task:error':
          dispatch({
            type: 'patch-task',
            task: {
              id: parsed.taskId,
              sliceKey: parsed.sliceKey,
              stage: parsed.stage,
              status: 'error' as RemakeTaskStatus,
              error: parsed.error,
            },
          });
          scheduleRefetch();
          break;
        case 'task:cancelled':
          dispatch({
            type: 'patch-task',
            task: {
              id: parsed.taskId,
              sliceKey: parsed.sliceKey,
              stage: parsed.stage,
              status: 'cancelled' as RemakeTaskStatus,
              error: parsed.reason,
            },
          });
          scheduleRefetch();
          break;
        case 'stage:status':
          dispatch({ type: 'patch-stage', stage: parsed.stage, status: parsed.status });
          break;
        case 'job:updated':
          // gate confirm / replan 时后端发，直接 refetch 整张 view
          scheduleRefetch();
          break;
      }
    };

    source.onerror = () => {
      // EventSource 会自动重连，这里只是记录；不写错误状态，避免和正常重连闪烁。
    };

    return () => {
      source.close();
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
        const payload = (await response.json()) as ApiResp<T>;
        if (!response.ok || !payload.ok) {
          dispatch({
            type: 'set-error',
            error: payload.ok ? 'request failed' : payload.error.message,
          });
          return null;
        }
        // 接口约定返回 RemakeJobView
        const view = payload.data as unknown as RemakeJobView;
        dispatch({ type: 'set-view', view });
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
      await post(`/api/remake/jobs/${jobId}/run-stage`, {
        stage: input.stage,
        ...(input.sliceKeys ? { sliceKeys: input.sliceKeys } : {}),
      });
    },
    [jobId, post],
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
  sceneImage: (index: number) => `scene-image-${index}`,
  sceneVideo: (index: number) => `scene-video-${index}`,
  sceneVoice: (index: number) => `scene-voice-${index}`,
  sceneMix: (index: number) => `scene-mix-${index}`,
  bgm: 'bgm',
  final: 'final-cut',
} as const;
