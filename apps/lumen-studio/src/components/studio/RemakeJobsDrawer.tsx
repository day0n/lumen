'use client';

import { useI18n } from '@/i18n/provider';
import { cn } from '@/lib/cn';
import type { RemakeJobRecord, RemakeStageName, RemakeStageStatus } from '@lumen/db';
import { IconArrowRight, IconCheck, IconLoader2, IconRefresh, IconX } from '@tabler/icons-react';
import { useCallback, useEffect, useState } from 'react';

/**
 * 「我的复刻任务」抽屉。
 *
 * GET /api/remake/jobs 拿用户所有 active job，按 updated_at 倒序。
 * 每个 job 显示参考视频缩略图 + 当前所在 stage + 6 stage 进度条 + 继续按钮。
 * 点继续 → 通过 ?job=<id> 路由跳到 Pipeline。
 */

interface ApiOk<T> {
  ok: true;
  data: T;
}
interface ApiErr {
  ok: false;
  error: { message: string };
}
type ApiResp<T> = ApiOk<T> | ApiErr;

const STAGE_ORDER: RemakeStageName[] = [
  'breakdown',
  'script',
  'lock',
  'storyboard',
  'video',
  'final',
];

export function RemakeJobsDrawer({
  open,
  onClose,
  onResume,
}: {
  open: boolean;
  onClose: () => void;
  onResume: (jobId: string) => void;
}) {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<RemakeJobRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchJobs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch('/api/remake/jobs?limit=50', {
        headers: { 'x-lumen-locale': locale },
      });
      const payload = (await response.json()) as ApiResp<{
        items: RemakeJobRecord[];
        total: number;
      }>;
      if (!response.ok || !payload.ok) {
        throw new Error(payload.ok ? 'unknown' : payload.error.message);
      }
      setItems(payload.data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'failed to load remake jobs');
    } finally {
      setLoading(false);
    }
  }, [locale]);

  useEffect(() => {
    if (!open) return;
    void fetchJobs();
  }, [open, fetchJobs]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex justify-end bg-black/52 backdrop-blur-sm"
      onClick={onClose}
      onKeyDown={(event) => {
        if (event.key === 'Escape') onClose();
      }}
      role="presentation"
    >
      <aside
        // 抽屉本体阻止冒泡，避免点到外层 backdrop 被关掉；键盘交互由抽屉内部的 button 接管。
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
        className="flex h-full w-full max-w-[420px] flex-col overflow-hidden bg-[#111315] shadow-[-24px_0_80px_-32px_rgba(0,0,0,0.85)] ring-1 ring-white/[0.08]"
      >
        <header className="flex items-center justify-between border-b border-white/[0.06] px-5 py-4">
          <div>
            <div className="text-[12px] font-bold uppercase tracking-wide text-white/40">
              {t('hotVideos.hotRefs')}
            </div>
            <div className="text-[16px] font-bold text-white">{t('hotVideos.myJobs')}</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void fetchJobs()}
              disabled={loading}
              aria-label={t('common.refresh')}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.05] text-white/62 ring-1 ring-white/[0.06] hover:bg-white/[0.09] hover:text-white disabled:opacity-50"
            >
              <IconRefresh size={15} className={loading ? 'animate-spin' : ''} stroke={2.2} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label={t('hotVideos.myJobsClose')}
              className="flex h-9 w-9 items-center justify-center rounded-xl bg-white/[0.05] text-white/62 ring-1 ring-white/[0.06] hover:bg-white/[0.09] hover:text-white"
            >
              <IconX size={16} stroke={2.2} />
            </button>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {error ? (
            <div className="rounded-[14px] bg-[#f5c76a]/10 px-4 py-3 text-[12px] leading-5 text-[#f5c76a] ring-1 ring-[#f5c76a]/22">
              {error}
            </div>
          ) : loading && !items ? (
            <div className="flex h-32 items-center justify-center text-white/52">
              <IconLoader2 size={20} className="animate-spin" />
            </div>
          ) : !items || items.length === 0 ? (
            <div className="rounded-[14px] bg-white/[0.04] px-5 py-8 text-center text-[12px] leading-5 text-white/48">
              {t('hotVideos.myJobsEmpty')}
            </div>
          ) : (
            <div className="space-y-3">
              {items.map((job) => (
                <RemakeJobRow
                  key={job.id}
                  job={job}
                  resumeLabel={t('hotVideos.myJobsResume')}
                  onResume={() => onResume(job.id)}
                />
              ))}
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function RemakeJobRow({
  job,
  resumeLabel,
  onResume,
}: {
  job: RemakeJobRecord;
  resumeLabel: string;
  onResume: () => void;
}) {
  const { locale, t } = useI18n();
  const stageStates = job.stages;
  const completed = STAGE_ORDER.filter((name) => stageStates[name].status === 'success').length;
  const currentStage = STAGE_ORDER.find(
    (name) => stageStates[name].status === 'running' || stageStates[name].status === 'ready',
  );
  const currentStageStatus: RemakeStageStatus | null = currentStage
    ? stageStates[currentStage].status
    : null;
  const updated = new Date(job.updatedAt);
  const updatedLabel = new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    numeric: 'auto',
  });
  const minutesAgo = Math.max(0, Math.round((Date.now() - updated.getTime()) / 60000));
  const updatedText =
    minutesAgo < 1
      ? locale === 'zh'
        ? '刚刚'
        : 'just now'
      : minutesAgo < 60
        ? updatedLabel.format(-minutesAgo, 'minute')
        : minutesAgo < 60 * 24
          ? updatedLabel.format(-Math.round(minutesAgo / 60), 'hour')
          : updatedLabel.format(-Math.round(minutesAgo / (60 * 24)), 'day');

  return (
    <button
      type="button"
      onClick={onResume}
      className="group flex w-full items-stretch gap-3 overflow-hidden rounded-[16px] bg-white/[0.04] p-3 text-left ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.07] hover:ring-white/[0.12]"
    >
      <div className="relative aspect-[9/16] w-[68px] shrink-0 overflow-hidden rounded-[12px] bg-black">
        {job.reference.thumbnailUrl ? (
          <img
            src={job.reference.thumbnailUrl}
            alt=""
            referrerPolicy="no-referrer"
            className="absolute inset-0 h-full w-full object-cover"
          />
        ) : (
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_28%_18%,rgba(121,228,255,0.26),transparent_34%),linear-gradient(145deg,#14181d,#2b3340_52%,#090b0d)]" />
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
        <div>
          <div className="line-clamp-2 text-[13px] font-bold leading-5 text-white">
            {job.reference.title ?? job.reference.label}
          </div>
          <div className="mt-1 line-clamp-1 text-[11px] text-white/40">{updatedText}</div>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex flex-1 gap-1">
            {STAGE_ORDER.map((name) => {
              const status = stageStates[name].status;
              return (
                <span
                  key={name}
                  className={cn(
                    'h-1.5 flex-1 rounded-full',
                    status === 'success' && 'bg-[#3ae08a]/72',
                    status === 'running' && 'bg-[#79e4ff]/72',
                    status === 'error' && 'bg-[#f5c76a]/72',
                    status === 'cancelled' && 'bg-white/22',
                    (status === 'ready' || status === 'locked') && 'bg-white/12',
                  )}
                />
              );
            })}
          </div>
          <span className="text-[10.5px] font-bold text-white/48">
            {t('hotVideos.myJobsProgress', { done: completed, total: STAGE_ORDER.length })}
          </span>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'rounded-full px-2 py-0.5 text-[10.5px] font-bold ring-1',
              currentStageStatus === 'running' &&
                'bg-[#79e4ff]/12 text-[#79e4ff] ring-[#79e4ff]/22',
              currentStageStatus === 'ready' && 'bg-white/[0.06] text-white/68 ring-white/[0.08]',
              !currentStageStatus && 'bg-[#3ae08a]/12 text-[#3ae08a] ring-[#3ae08a]/22',
            )}
          >
            {currentStage ?? 'final'}
          </span>
          <span className="flex items-center gap-1 text-[11px] font-bold text-white/72 transition-colors group-hover:text-white">
            {currentStageStatus === 'running' ? (
              <IconLoader2 size={12} className="animate-spin" />
            ) : !currentStageStatus ? (
              <IconCheck size={12} stroke={2.6} />
            ) : null}
            {resumeLabel}
            <IconArrowRight size={12} stroke={2.4} />
          </span>
        </div>
      </div>
    </button>
  );
}
