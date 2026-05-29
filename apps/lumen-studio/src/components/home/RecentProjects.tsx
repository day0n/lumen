'use client';

import { IconArrowRight, IconDots, IconMovie, IconPhoto, IconPlus } from '@tabler/icons-react';
import { motion } from 'motion/react';
import Link from 'next/link';

interface RecentProject {
  id: string;
  name: string;
  date: string;
  badge?: string;
  background: string;
}

const RECENT: RecentProject[] = [
  {
    id: '1',
    name: '夏日防晒面膜 · v3',
    date: '2026/05/25',
    badge: 'Seedance 2.0',
    background: 'linear-gradient(135deg,#343a40,#1d2633 70%,#203956)',
  },
  {
    id: '2',
    name: '能量棒 · ASMR 版',
    date: '2026/05/23',
    background: 'linear-gradient(135deg,#242629,#20252d 65%,#34475c)',
  },
  {
    id: '3',
    name: '面膜 · 英文版 A/B',
    date: '2026/05/23',
    background: 'linear-gradient(135deg,#242629,#292d35 58%,#485972)',
  },
];

export function RecentProjects() {
  return (
    <section className="mx-auto mt-16 max-w-[1260px] px-6">
      <div className="mb-4 flex items-center">
        <h2 className="text-[18px] font-bold text-white">最近项目</h2>
        <Link
          href="/canvas/projects"
          className="ml-auto inline-flex items-center gap-1 text-[12px] text-white/42 transition-colors hover:text-white"
        >
          全部项目
          <IconArrowRight size={13} stroke={2.2} />
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Link
          href="/canvas/new"
          className="group flex min-h-[138px] flex-col overflow-hidden rounded-xl bg-[#202327] ring-1 ring-white/[0.06] transition-colors hover:bg-[#252a30]"
        >
          <div className="flex flex-1 items-center justify-center bg-[linear-gradient(135deg,#33383e,#202a38)]">
            <span className="flex flex-col items-center gap-2 text-white/75">
              <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white text-[#111315]">
                <IconPlus size={21} stroke={2.8} />
              </span>
              <span className="text-[13px] font-semibold">开始创作</span>
            </span>
          </div>
          <div className="flex h-10 items-center justify-center gap-1.5 bg-[#343941] text-[12px] font-semibold text-white/72">
            <IconMovie size={14} stroke={2.1} />
            Seedance2.0
          </div>
        </Link>

        {RECENT.map((project, index) => (
          <ProjectCard key={project.id} project={project} index={index} />
        ))}
      </div>
    </section>
  );
}

function ProjectCard({ project, index }: { project: RecentProject; index: number }) {
  return (
    <motion.button
      type="button"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.05, ease: [0.32, 0.72, 0, 1] }}
      className="group min-h-[138px] overflow-hidden rounded-xl bg-[#1f2022] text-left ring-1 ring-white/[0.05] transition-colors hover:bg-[#25272a]"
    >
      <div
        className="flex h-[104px] items-center justify-center"
        style={{ background: project.background }}
      >
        <IconPhoto
          size={38}
          className="text-white/20 transition-colors group-hover:text-white/32"
          stroke={1.6}
        />
      </div>
      <div className="px-3.5 py-2.5">
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-semibold text-white/82">{project.name}</div>
            <div className="mt-1 text-[11px] text-white/35">{project.date}</div>
          </div>
          <IconDots size={16} className="mt-0.5 text-white/35" stroke={2.2} />
        </div>
        {project.badge && (
          <div className="mt-2 inline-flex rounded-md bg-white/[0.06] px-2 py-1 text-[10px] text-white/55">
            {project.badge}
          </div>
        )}
      </div>
    </motion.button>
  );
}
