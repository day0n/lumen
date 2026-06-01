'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/cn';

interface RecentProject {
  id: string;
  name: string;
  meta: string;
  status: 'running' | 'done' | 'draft';
  progress?: string;
  gradient: string;
}

const RECENT: RecentProject[] = [
  {
    id: '1',
    name: '夏日防晒面膜 · v3',
    meta: '2 分钟前',
    status: 'running',
    progress: '生成中 3/5',
    gradient: 'linear-gradient(135deg, #ff4d2e, #b48fff)',
  },
  {
    id: '2',
    name: '能量棒 · ASMR 版',
    meta: '1 小时前',
    status: 'done',
    gradient: 'linear-gradient(135deg, #4ade80, #2a4cff)',
  },
  {
    id: '3',
    name: '面膜 · 英文版 A/B',
    meta: '昨天',
    status: 'done',
    gradient: 'linear-gradient(135deg, #ffb02a, #ff7a4a)',
  },
  {
    id: '4',
    name: '磁吸耳机 Pro',
    meta: '2 天前',
    status: 'draft',
    gradient: 'linear-gradient(135deg, #2a4cff, #b48fff)',
  },
  {
    id: '5',
    name: '复古牛仔外套',
    meta: '3 天前',
    status: 'done',
    gradient: 'linear-gradient(135deg, #ff7a4a, #ff4d2e)',
  },
  {
    id: '6',
    name: '薰衣草助眠香薰',
    meta: '1 周前',
    status: 'done',
    gradient: 'linear-gradient(135deg, #b48fff, #4ade80)',
  },
];

export function RecentProjects() {
  return (
    <section className="mt-20">
      <div className="mx-auto mb-7 flex max-w-[1280px] items-end gap-4 px-10">
        <div>
          <h2 className="font-display text-[22px] font-bold tracking-tight text-white">
            最近的项目
          </h2>
          <p className="mt-1 text-[12.5px] text-white/45">继续上次的创作</p>
        </div>
        <button
          type="button"
          className="ml-auto inline-flex items-center gap-1 text-[12.5px] text-white/55 transition-colors hover:text-white"
        >
          所有项目
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6" />
          </svg>
        </button>
      </div>

      <div className="mx-auto max-w-[1280px] overflow-hidden">
        <div className="flex gap-4 px-10 pb-3 overflow-x-auto scrollbar-hide">
          <NewProjectCard />
          {RECENT.map((p, idx) => (
            <ProjectCard key={p.id} project={p} index={idx} />
          ))}
        </div>
      </div>
    </section>
  );
}

function NewProjectCard() {
  return (
    <motion.button
      type="button"
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 240, damping: 18 }}
      className="group relative flex h-[180px] w-[240px] shrink-0 flex-col items-center justify-center gap-3 overflow-hidden rounded-2xl border border-dashed border-white/14 bg-white/[0.02] transition-colors hover:border-flame-400/50 hover:bg-flame-500/[0.04]"
    >
      <div
        className="flex h-12 w-12 items-center justify-center rounded-full text-white text-2xl"
        style={{
          background: 'linear-gradient(135deg, #ff7a4a, #ff4d2e)',
          boxShadow: '0 8px 20px -4px rgba(255,77,46,0.5)',
        }}
      >
        +
      </div>
      <span className="text-[13px] font-medium text-white/80">新建视频</span>
      <span className="text-[11px] text-white/40">从画布或模板开始</span>

      {/* hover ember 光晕 */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity group-hover:opacity-100"
        style={{
          background:
            'radial-gradient(circle at 50% 100%, rgba(255,77,46,0.25), transparent 60%)',
        }}
      />
    </motion.button>
  );
}

function ProjectCard({ project, index }: { project: RecentProject; index: number }) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.05 * index, ease: [0.32, 0.72, 0, 1] }}
      whileHover={{ y: -3 }}
      className="group relative h-[180px] w-[240px] shrink-0 overflow-hidden rounded-2xl bg-white/[0.03] text-left transition-all hover:bg-white/[0.06]"
      style={{ border: '1px solid rgba(255,255,255,0.06)' }}
    >
      {/* 顶部封面 */}
      <div className="relative h-[110px] w-full overflow-hidden" style={{ background: project.gradient }}>
        {/* 颗粒 */}
        <div
          aria-hidden
          className="absolute inset-0 opacity-20 mix-blend-overlay"
          style={{
            backgroundImage:
              "url(\"data:image/svg+xml,%3Csvg viewBox='0 0 200 200' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")",
          }}
        />
        {/* 状态徽章 */}
        <div className="absolute left-3 top-3">
          <StatusBadge status={project.status} progress={project.progress} />
        </div>
        {/* hover 出现的播放键 */}
        <div className="absolute inset-0 flex items-center justify-center opacity-0 transition-opacity group-hover:opacity-100">
          <div
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/95 text-black backdrop-blur"
            style={{ boxShadow: '0 6px 16px -4px rgba(0,0,0,0.5)' }}
          >
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor">
              <polygon points="5 3 19 12 5 21 5 3" />
            </svg>
          </div>
        </div>
      </div>

      <div className="px-3.5 py-3">
        <div className="truncate text-[13px] font-medium text-white">{project.name}</div>
        <div className="mt-1 flex items-center justify-between text-[11px] text-white/40">
          <span>{project.meta}</span>
          <span className="text-flame-400 opacity-0 transition-opacity group-hover:opacity-100">
            打开 →
          </span>
        </div>
      </div>
    </motion.button>
  );
}

function StatusBadge({
  status,
  progress,
}: {
  status: RecentProject['status'];
  progress?: string;
}) {
  const labels = {
    running: progress ?? '生成中',
    done: '已完成',
    draft: '草稿',
  };
  const dotColors = {
    running: '#ffb02a',
    done: '#4ade80',
    draft: '#9ca3af',
  };
  return (
    <div
      className={cn(
        'inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[10px] font-medium text-white backdrop-blur-md',
      )}
      style={{ background: 'rgba(0,0,0,0.5)' }}
    >
      <span
        className={cn('h-1.5 w-1.5 rounded-full', status === 'running' && 'animate-pulse')}
        style={{ background: dotColors[status], boxShadow: `0 0 6px ${dotColors[status]}` }}
      />
      {labels[status]}
    </div>
  );
}
