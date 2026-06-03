'use client';

import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { Topbar } from '@/components/home/Topbar';
import { useI18n } from '@/i18n/provider';
import type { Locale } from '@/i18n/routing';
import { useLoginRedirect } from '@/lib/auth-redirect';
import { IconDotsVertical, IconPhoto, IconPlus, IconSearch } from '@tabler/icons-react';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

interface StudioProject {
  id: string;
  name: string;
  updatedAt: string;
  cover: string;
  coverMode?: 'tutorial' | 'soft';
}

interface ProjectListRecord {
  id: string;
  title: string;
  updatedAt: string;
}

type ProjectsApiResponse =
  | {
      ok: true;
      data: {
        projects: ProjectListRecord[];
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

export function WorkspacePage() {
  const { locale, t, localePath } = useI18n();
  const { isLoaded: authLoaded, isSignedIn, requireLogin } = useLoginRedirect();
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!authLoaded) return;
    if (!isSignedIn) {
      requireLogin('/canvas/projects');
      return;
    }

    const controller = new AbortController();

    async function loadProjects() {
      try {
        const response = await fetch('/api/projects', {
          signal: controller.signal,
          headers: { 'x-lumen-locale': locale },
        });
        const payload = (await response.json()) as ProjectsApiResponse;

        if (!response.ok || !payload.ok) {
          throw new Error(payload.ok ? t('workspace.readFailed') : payload.error.message);
        }

        setProjects(payload.data.projects.map((project) => toStudioProject(project, locale, t)));
        setError(null);
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : t('workspace.readFailed'));
        }
      }
    }

    void loadProjects();
    return () => controller.abort();
  }, [authLoaded, isSignedIn, locale, requireLogin, t]);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const visibleProjects = useMemo(() => {
    if (!trimmedQuery) return projects;
    return projects.filter((project) => project.name.toLowerCase().includes(trimmedQuery));
  }, [projects, trimmedQuery]);
  const hasNoMatches = trimmedQuery.length > 0 && visibleProjects.length === 0;

  return (
    <div className="relative min-h-screen text-white">
      <AuroraBackdrop />
      <Topbar />

      <main className="relative z-10 mx-auto max-w-[1180px] px-6 pb-16 pt-28">
        <div className="mb-5 flex flex-wrap items-center gap-3">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-white">
              {t('workspace.title')}
            </h1>
            <p className="mt-1 text-[12px] text-white/35">{t('workspace.subtitle')}</p>
          </div>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <label className="flex h-10 w-[190px] items-center gap-2 rounded-xl bg-[#171819] px-3 text-white/45 ring-1 ring-white/[0.08] focus-within:ring-white/20">
              <IconSearch size={16} stroke={2.1} />
              <input
                type="search"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/35"
                placeholder={t('workspace.searchPlaceholder')}
                aria-label={t('workspace.searchPlaceholder')}
              />
            </label>
          </div>
        </div>

        {error ? (
          <div className="mb-4 rounded-xl bg-[#2a171a]/72 px-4 py-3 text-[13px] text-[#ffabb6] ring-1 ring-[#ff5d73]/16">
            {error}
          </div>
        ) : null}

        {hasNoMatches ? (
          <div className="rounded-xl bg-[#171819]/70 px-4 py-10 text-center text-[13px] text-white/55 ring-1 ring-white/[0.06]">
            {t('workspace.searchEmpty', { query: searchQuery.trim() })}
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-5">
            {trimmedQuery ? null : <NewProjectCard href={localePath('/canvas/new')} />}
            {visibleProjects.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                href={localePath(`/canvas/${project.id}`)}
              />
            ))}
          </div>
        )}
      </main>
    </div>
  );
}

function NewProjectCard({ href }: { href: string }) {
  const { t } = useI18n();
  return (
    <Link
      href={href}
      className="group relative flex min-h-[160px] flex-col items-center justify-center gap-3 overflow-hidden rounded-xl bg-[#171b20] ring-1 ring-white/[0.1] transition-colors hover:bg-[#1b2027]"
    >
      <span
        aria-hidden
        className="absolute inset-0 opacity-95"
        style={{
          background:
            'radial-gradient(circle at 18% 16%,rgba(123,195,255,0.28),transparent 34%),radial-gradient(circle at 88% 88%,rgba(36,70,122,0.48),transparent 42%),linear-gradient(135deg,rgba(255,255,255,0.06),transparent 34%)',
        }}
      />
      <span className="relative flex h-12 w-12 items-center justify-center rounded-full bg-white text-[#111315] shadow-[0_14px_34px_-16px_rgba(255,255,255,0.9)]">
        <IconPlus size={24} stroke={2.7} />
      </span>
      <span className="relative text-[13px] font-bold text-white/88">
        {t('workspace.newProject')}
      </span>
      <span className="relative text-[11px] text-white/42">
        {t('workspace.newProjectSubtitle')}
      </span>
    </Link>
  );
}

function ProjectCard({ project, href }: { project: StudioProject; href: string }) {
  const { t } = useI18n();
  return (
    <Link
      href={href}
      className="group overflow-hidden rounded-xl bg-[#202121] p-2.5 text-left ring-1 ring-white/[0.08] transition-colors hover:bg-[#262829]"
    >
      <div
        className="relative h-[116px] overflow-hidden rounded-lg"
        style={{ background: project.cover }}
      >
        {project.coverMode === 'tutorial' ? (
          <div className="absolute inset-0 flex items-center justify-center bg-[repeating-linear-gradient(90deg,rgba(255,255,255,0.05)_0,rgba(255,255,255,0.05)_8px,transparent_8px,transparent_18px)]">
            <div className="text-center">
              <div className="font-display text-[18px] font-extrabold tracking-wider text-white/55">
                LUMEN
              </div>
              <div className="text-[18px] font-black text-white">{t('workspace.tutorial')}</div>
            </div>
          </div>
        ) : (
          <div className="absolute inset-0 opacity-60 mix-blend-soft-light [background-image:linear-gradient(120deg,transparent_20%,rgba(255,255,255,0.45)_48%,transparent_62%)]" />
        )}
        {project.coverMode === 'soft' && (
          <IconPhoto
            size={32}
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-white/18"
            stroke={1.7}
          />
        )}
      </div>

      <div className="mt-2 flex items-start gap-2 px-0.5 pb-0.5">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-bold text-white/88">{project.name}</div>
          <div className="mt-1 text-[11px] text-white/35">{project.updatedAt}</div>
        </div>
        <span className="flex h-7 w-7 items-center justify-center rounded-lg text-white/35 transition-colors group-hover:bg-white/[0.06] group-hover:text-white/72">
          <IconDotsVertical size={15} stroke={2.2} />
        </span>
      </div>
    </Link>
  );
}

function toStudioProject(
  project: ProjectListRecord,
  locale: Locale,
  t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string,
): StudioProject {
  return {
    id: project.id,
    name: project.title || t('workspace.untitled'),
    updatedAt: formatUpdatedAt(project.updatedAt, locale, t),
    cover: coverForProject(project.id),
    coverMode: project.id.charCodeAt(0) % 3 === 0 ? 'soft' : undefined,
  };
}

function formatUpdatedAt(
  value: string,
  locale: Locale,
  t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string,
) {
  const updatedAt = new Date(value);
  if (Number.isNaN(updatedAt.getTime())) return t('workspace.editedJustNow');

  const diffMs = Math.max(0, Date.now() - updatedAt.getTime());
  const minutes = Math.floor(diffMs / 60_000);
  if (minutes < 1) return t('workspace.editedJustNow');
  if (minutes < 60)
    return t('home.edited', {
      time: new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
        numeric: 'auto',
      }).format(-minutes, 'minute'),
    });

  const hours = Math.floor(minutes / 60);
  if (hours < 24)
    return t('home.edited', {
      time: new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
        numeric: 'auto',
      }).format(-hours, 'hour'),
    });

  const days = Math.floor(hours / 24);
  if (days < 30)
    return t('home.edited', {
      time: new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
        numeric: 'auto',
      }).format(-days, 'day'),
    });

  const months = Math.floor(days / 30);
  return t('home.edited', {
    time: new Intl.RelativeTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
      numeric: 'auto',
    }).format(-months, 'month'),
  });
}

function coverForProject(projectId: string) {
  const variants = [
    'radial-gradient(circle at 18% 12%,rgba(130,196,255,0.72),transparent 34%),radial-gradient(circle at 86% 78%,rgba(37,72,128,0.92),transparent 45%),linear-gradient(135deg,#101821,#243246 54%,#0a0d11)',
    'radial-gradient(circle at 26% 28%,rgba(206,219,232,0.54),transparent 30%),radial-gradient(circle at 72% 16%,rgba(96,132,171,0.72),transparent 38%),linear-gradient(135deg,#151a20,#2d3744 58%,#0b0d10)',
    'radial-gradient(circle at 76% 18%,rgba(123,171,219,0.78),transparent 36%),radial-gradient(circle at 18% 86%,rgba(27,53,91,0.86),transparent 42%),linear-gradient(135deg,#0f141b,#263648 62%,#0b0d10)',
    'radial-gradient(circle at 28% 18%,rgba(113,164,225,0.78),transparent 38%),radial-gradient(circle at 80% 82%,rgba(62,89,157,0.72),transparent 42%),linear-gradient(135deg,#101722,#253557 56%,#0b0d12)',
  ] as const;
  const seed = [...projectId].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return variants[seed % variants.length] ?? variants[0];
}
