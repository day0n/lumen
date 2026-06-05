'use client';

import { preloadCanvasHydrationOverlay } from '@/components/canvas/preload-canvas-hydration';
import { AuroraBackdrop } from '@/components/home/AuroraBackdrop';
import { Topbar } from '@/components/home/Topbar';
import { useI18n } from '@/i18n/provider';
import type { Locale } from '@/i18n/routing';
import { useLoginRedirect } from '@/lib/auth-redirect';
import { cn } from '@/lib/cn';
import {
  IconCheck,
  IconDotsVertical,
  IconFlame,
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconLayoutGrid,
  IconLayoutSidebarLeftCollapse,
  IconLayoutSidebarLeftExpand,
  IconPencil,
  IconPhoto,
  IconPlus,
  IconSearch,
  IconTrash,
} from '@tabler/icons-react';
import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  type FormEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

interface StudioProject {
  id: string;
  name: string;
  updatedAt: string;
  cover: string;
  thumbnail?: string;
  coverMode?: 'tutorial' | 'soft';
  folderId?: string;
}

interface ProjectListRecord {
  id: string;
  title: string;
  folderId?: string;
  updatedAt: string;
  thumbnail?: string;
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

interface FolderRecord {
  id: string;
  name: string;
  systemKey?: 'viral_remix';
}

type FoldersApiResponse =
  | {
      ok: true;
      data: {
        folders: FolderRecord[];
        counts: Record<string, number>;
      };
    }
  | {
      ok: false;
      error: { message: string };
    };

/** 侧栏选中的范围：`null` = 全部，字符串 = 某文件夹 id，`'uncategorized'` = 未分类。 */
type SelectedScope = null | 'uncategorized' | string;

export function WorkspacePage() {
  const { locale, t, localePath } = useI18n();
  const router = useRouter();
  const { isLoaded: authLoaded, isSignedIn, requireLogin } = useLoginRedirect();
  const [projects, setProjects] = useState<StudioProject[]>([]);
  const [folders, setFolders] = useState<FolderRecord[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedScope, setSelectedScope] = useState<SelectedScope>(null);
  const [creatingFolder, setCreatingFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [folderActionError, setFolderActionError] = useState<string | null>(null);
  // 默认收起：避免文件夹列表挡住主网格；用户显式展开过会写入 localStorage 后保持。
  const [sidebarCollapsed, setSidebarCollapsed] = useState(true);
  // 首次抓 projects/folders 时铺一层骨架卡，避免用户先看到「空白 + 新建卡」再瞬间跳出真实数据。
  // 只在初次加载时为 true；后续刷新（移动、删除、重命名）走乐观更新，不再回到骨架态。
  const [isInitialLoading, setIsInitialLoading] = useState(true);

  const warmCanvasDestination = useCallback(
    (href?: string) => {
      void preloadCanvasHydrationOverlay();
      if (href) router.prefetch(href);
    },
    [router],
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('workspace.sidebar.collapsed');
    // 只有显式存了 '0' 才视为用户偏好展开；其他情况（首次访问 / 旧记录）都保持折叠默认。
    if (stored === '0') setSidebarCollapsed(false);
  }, []);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('workspace.sidebar.collapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  const loadFolders = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch('/api/folders', {
          signal,
          headers: { 'x-lumen-locale': locale },
        });
        const payload = (await response.json()) as FoldersApiResponse;
        if (!response.ok || !payload.ok) {
          throw new Error(payload.ok ? t('workspace.readFailed') : payload.error.message);
        }
        setFolders(payload.data.folders);
        setCounts(payload.data.counts);
      } catch (loadError) {
        if (signal?.aborted) return;
        setError(loadError instanceof Error ? loadError.message : t('workspace.readFailed'));
      }
    },
    [locale, t],
  );

  const loadProjects = useCallback(
    async (signal?: AbortSignal) => {
      try {
        const response = await fetch('/api/projects', {
          signal,
          headers: { 'x-lumen-locale': locale },
        });
        const payload = (await response.json()) as ProjectsApiResponse;

        if (!response.ok || !payload.ok) {
          throw new Error(payload.ok ? t('workspace.readFailed') : payload.error.message);
        }

        setProjects(payload.data.projects.map((project) => toStudioProject(project, locale, t)));
        setError(null);
      } catch (loadError) {
        if (signal?.aborted) return;
        setError(loadError instanceof Error ? loadError.message : t('workspace.readFailed'));
      }
    },
    [locale, t],
  );

  useEffect(() => {
    if (!authLoaded) return;
    if (!isSignedIn) {
      // 未登录时让 requireLogin 接管跳转，骨架可以收掉了。
      setIsInitialLoading(false);
      requireLogin('/canvas/projects');
      return;
    }

    const controller = new AbortController();
    void Promise.all([loadProjects(controller.signal), loadFolders(controller.signal)]).finally(
      () => {
        if (!controller.signal.aborted) setIsInitialLoading(false);
      },
    );
    return () => controller.abort();
  }, [authLoaded, isSignedIn, requireLogin, loadProjects, loadFolders]);

  useEffect(() => {
    if (!authLoaded || !isSignedIn || isInitialLoading) return;

    const hrefs = [
      localePath('/canvas/new'),
      ...projects.slice(0, 6).map((project) => localePath(`/canvas/${project.id}`)),
    ];
    let cancelled = false;

    const warm = () => {
      if (cancelled) return;
      void preloadCanvasHydrationOverlay();
      for (const href of hrefs) router.prefetch(href);
    };

    const requestIdle = window.requestIdleCallback;
    const cancelIdle = window.cancelIdleCallback;
    if (typeof requestIdle === 'function' && typeof cancelIdle === 'function') {
      const idleId = requestIdle(warm, { timeout: 1400 });
      return () => {
        cancelled = true;
        cancelIdle(idleId);
      };
    }

    const timeoutId = globalThis.setTimeout(warm, 520);
    return () => {
      cancelled = true;
      globalThis.clearTimeout(timeoutId);
    };
  }, [authLoaded, isInitialLoading, isSignedIn, localePath, projects, router]);

  const trimmedQuery = searchQuery.trim().toLowerCase();
  const scopedProjects = useMemo(() => {
    if (selectedScope === null) return projects;
    if (selectedScope === 'uncategorized') return projects.filter((p) => !p.folderId);
    return projects.filter((p) => p.folderId === selectedScope);
  }, [projects, selectedScope]);

  const visibleProjects = useMemo(() => {
    if (!trimmedQuery) return scopedProjects;
    return scopedProjects.filter((project) => project.name.toLowerCase().includes(trimmedQuery));
  }, [scopedProjects, trimmedQuery]);

  const hasNoMatches = trimmedQuery.length > 0 && visibleProjects.length === 0;

  const moveProject = useCallback(
    async (projectId: string, folderId: string | null) => {
      const previous = projects;
      setProjects((current) =>
        current.map((project) =>
          project.id === projectId ? { ...project, folderId: folderId ?? undefined } : project,
        ),
      );

      try {
        const response = await fetch(`/api/projects/${projectId}`, {
          method: 'PATCH',
          headers: {
            'content-type': 'application/json',
            'x-lumen-locale': locale,
          },
          body: JSON.stringify({ folderId }),
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            ok: false;
            error?: { message?: string };
          } | null;
          throw new Error(payload?.error?.message ?? t('workspace.folders.moveFailed'));
        }
        void loadFolders();
      } catch (moveError) {
        setProjects(previous);
        setError(
          moveError instanceof Error ? moveError.message : t('workspace.folders.moveFailed'),
        );
      }
    },
    [projects, locale, t, loadFolders],
  );

  const deleteProject = useCallback(
    async (project: StudioProject) => {
      const ok = window.confirm(
        t('workspace.folders.confirmDeleteWorkflow', { name: project.name }),
      );
      if (!ok) return;

      const previous = projects;
      setProjects((current) => current.filter((item) => item.id !== project.id));

      try {
        const response = await fetch(`/api/projects/${project.id}`, {
          method: 'DELETE',
          headers: { 'x-lumen-locale': locale },
        });
        if (!response.ok) {
          const payload = (await response.json().catch(() => null)) as {
            ok: false;
            error?: { message?: string };
          } | null;
          throw new Error(payload?.error?.message ?? t('workspace.folders.deleteWorkflowFailed'));
        }
        void loadFolders();
      } catch (deleteError) {
        setProjects(previous);
        setError(
          deleteError instanceof Error
            ? deleteError.message
            : t('workspace.folders.deleteWorkflowFailed'),
        );
      }
    },
    [projects, locale, t, loadFolders],
  );

  const handleCreateFolder = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const name = newFolderName.trim();
    if (!name) return;

    setFolderActionError(null);
    try {
      const response = await fetch('/api/folders', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-lumen-locale': locale,
        },
        body: JSON.stringify({ name }),
      });
      const payload = (await response.json()) as
        | { ok: true; data: { folder: FolderRecord } }
        | { ok: false; error: { message: string } };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.ok ? t('workspace.folders.createFailed') : payload.error.message);
      }
      setFolders((current) => [...current, payload.data.folder]);
      setCreatingFolder(false);
      setNewFolderName('');
      setSelectedScope(payload.data.folder.id);
    } catch (createError) {
      setFolderActionError(
        createError instanceof Error ? createError.message : t('workspace.folders.createFailed'),
      );
    }
  };

  const handleRenameFolder = async (folder: FolderRecord) => {
    const next = window.prompt(t('workspace.folders.rename'), folder.name)?.trim();
    if (!next || next === folder.name) return;

    try {
      const response = await fetch(`/api/folders/${folder.id}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json', 'x-lumen-locale': locale },
        body: JSON.stringify({ name: next }),
      });
      const payload = (await response.json()) as
        | { ok: true; data: { folder: FolderRecord } }
        | { ok: false; error: { message: string } };
      if (!response.ok || !payload.ok) {
        throw new Error(payload.ok ? t('workspace.folders.renameFailed') : payload.error.message);
      }
      setFolders((current) =>
        current.map((item) => (item.id === folder.id ? payload.data.folder : item)),
      );
    } catch (renameError) {
      setError(
        renameError instanceof Error ? renameError.message : t('workspace.folders.renameFailed'),
      );
    }
  };

  const handleDeleteFolder = async (folder: FolderRecord) => {
    const workflowCount = counts[folder.id] ?? 0;
    const ok = window.confirm(
      workflowCount > 0
        ? t('workspace.folders.confirmDeleteWithWorkflows', {
            name: folderDisplayName(folder, t),
            count: workflowCount,
          })
        : t('workspace.folders.confirmDelete', { name: folderDisplayName(folder, t) }),
    );
    if (!ok) return;

    try {
      const response = await fetch(`/api/folders/${folder.id}`, {
        method: 'DELETE',
        headers: { 'x-lumen-locale': locale },
      });
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as {
          ok: false;
          error?: { message?: string };
        } | null;
        throw new Error(payload?.error?.message ?? t('workspace.folders.deleteFailed'));
      }
      setFolders((current) => current.filter((item) => item.id !== folder.id));
      if (selectedScope === folder.id) setSelectedScope(null);
      void Promise.all([loadProjects(), loadFolders()]);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error ? deleteError.message : t('workspace.folders.deleteFailed'),
      );
    }
  };

  const sortedFolders = useMemo(() => {
    // 系统文件夹永远在前
    const sorted = [...folders];
    sorted.sort((a, b) => {
      if (a.systemKey && !b.systemKey) return -1;
      if (!a.systemKey && b.systemKey) return 1;
      return 0;
    });
    return sorted;
  }, [folders]);

  return (
    <div className="relative min-h-screen text-white">
      <AuroraBackdrop />
      <Topbar />

      <main className="relative z-10 mx-auto max-w-[1320px] px-4 pb-nav-mobile pt-24 sm:px-6 sm:pt-28">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight text-white">
              {t('workspace.title')}
            </h1>
            <p className="mt-1 text-[12px] text-white/35">{t('workspace.subtitle')}</p>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:ml-auto sm:w-auto">
            <label className="flex h-11 min-h-11 w-full items-center gap-2 rounded-xl bg-[#171819] px-3 text-white/45 ring-1 ring-white/[0.08] focus-within:ring-white/20 sm:h-10 sm:w-[190px]">
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

        <div
          className={cn(
            'grid gap-6',
            sidebarCollapsed
              ? 'lg:grid-cols-[44px_minmax(0,1fr)]'
              : 'lg:grid-cols-[220px_minmax(0,1fr)]',
          )}
        >
          <aside
            className={cn('space-y-1', sidebarCollapsed && 'lg:sticky lg:top-28 lg:self-start')}
          >
            {sidebarCollapsed ? (
              <button
                type="button"
                onClick={() => setSidebarCollapsed(false)}
                title={t('common.expand')}
                aria-label={t('common.expand')}
                className="group flex h-[148px] w-11 flex-col items-center justify-center gap-3 rounded-2xl bg-[#171819] text-white/55 ring-1 ring-white/[0.08] transition-colors hover:bg-white/[0.06] hover:text-white lg:sticky lg:top-28"
              >
                <IconLayoutSidebarLeftExpand size={20} stroke={2.1} />
                <span
                  className="text-[10px] font-bold uppercase tracking-[0.18em] text-white/35 transition-colors group-hover:text-white/72"
                  style={{ writingMode: 'vertical-rl' }}
                >
                  {t('workspace.folders.heading')}
                </span>
              </button>
            ) : (
              <>
                <div className="mb-2 flex items-center justify-between px-1">
                  <span className="text-[11px] font-bold uppercase tracking-[0.12em] text-white/35">
                    {t('workspace.folders.heading')}
                  </span>
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setCreatingFolder(true);
                        setFolderActionError(null);
                      }}
                      title={t('workspace.folders.newFolder')}
                      aria-label={t('workspace.folders.newFolder')}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white"
                    >
                      <IconFolderPlus size={15} stroke={2.2} />
                    </button>
                    <button
                      type="button"
                      onClick={() => setSidebarCollapsed(true)}
                      title={t('common.collapse')}
                      aria-label={t('common.collapse')}
                      className="flex h-6 w-6 items-center justify-center rounded-md text-white/45 transition-colors hover:bg-white/[0.06] hover:text-white"
                    >
                      <IconLayoutSidebarLeftCollapse size={15} stroke={2.2} />
                    </button>
                  </div>
                </div>

                <FolderSidebarItem
                  icon={<IconLayoutGrid size={15} stroke={2.2} />}
                  label={t('workspace.folders.all')}
                  count={projects.length}
                  active={selectedScope === null}
                  onClick={() => setSelectedScope(null)}
                />
                <FolderSidebarItem
                  icon={<IconFolder size={15} stroke={2.2} />}
                  label={t('workspace.folders.uncategorized')}
                  count={counts.uncategorized ?? 0}
                  active={selectedScope === 'uncategorized'}
                  onClick={() => setSelectedScope('uncategorized')}
                />

                {sortedFolders.map((folder) => (
                  <FolderSidebarItem
                    key={folder.id}
                    icon={
                      folder.systemKey === 'viral_remix' ? (
                        <IconFlame size={15} stroke={2.2} />
                      ) : selectedScope === folder.id ? (
                        <IconFolderOpen size={15} stroke={2.2} />
                      ) : (
                        <IconFolder size={15} stroke={2.2} />
                      )
                    }
                    label={folderDisplayName(folder, t)}
                    count={counts[folder.id] ?? 0}
                    active={selectedScope === folder.id}
                    onClick={() => setSelectedScope(folder.id)}
                    onRename={folder.systemKey ? undefined : () => handleRenameFolder(folder)}
                    onDelete={folder.systemKey ? undefined : () => handleDeleteFolder(folder)}
                  />
                ))}

                {creatingFolder ? (
                  <form
                    onSubmit={handleCreateFolder}
                    className="mt-2 rounded-lg bg-white/[0.04] p-2 ring-1 ring-white/[0.08]"
                  >
                    <input
                      // biome-ignore lint/a11y/noAutofocus: input only mounts on user request, focusing is the expected behavior.
                      autoFocus
                      type="text"
                      value={newFolderName}
                      onChange={(event) => setNewFolderName(event.target.value)}
                      placeholder={t('workspace.folders.newFolderPlaceholder')}
                      className="w-full bg-transparent text-[13px] text-white outline-none placeholder:text-white/30"
                    />
                    {folderActionError ? (
                      <div className="mt-1 text-[11px] text-[#ffabb6]">{folderActionError}</div>
                    ) : null}
                    <div className="mt-2 flex items-center justify-end gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setCreatingFolder(false);
                          setNewFolderName('');
                          setFolderActionError(null);
                        }}
                        className="rounded-md px-2 py-1 text-[11px] text-white/55 hover:bg-white/[0.05] hover:text-white"
                      >
                        {t('workspace.folders.cancel')}
                      </button>
                      <button
                        type="submit"
                        disabled={newFolderName.trim().length === 0}
                        className="rounded-md bg-white px-2.5 py-1 text-[11px] font-bold text-[#111315] transition-opacity disabled:opacity-40"
                      >
                        {t('workspace.folders.create')}
                      </button>
                    </div>
                  </form>
                ) : null}
              </>
            )}
          </aside>

          <div className="min-w-0">
            {isInitialLoading ? (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {Array.from({ length: PROJECT_SKELETON_COUNT }).map((_, index) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: 骨架占位卡是同质静态项，使用 index 作为 key 不会引发协调问题。
                  <ProjectCardSkeleton key={`workspace-skeleton-${index}`} />
                ))}
              </div>
            ) : hasNoMatches ? (
              <div className="rounded-xl bg-[#171819]/70 px-4 py-10 text-center text-[13px] text-white/55 ring-1 ring-white/[0.06]">
                {t('workspace.searchEmpty', { query: searchQuery.trim() })}
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                {trimmedQuery || selectedScope !== null ? null : (
                  <NewProjectCard
                    href={localePath('/canvas/new')}
                    onWarm={warmCanvasDestination}
                  />
                )}
                {visibleProjects.map((project) => (
                  <ProjectCard
                    key={project.id}
                    project={project}
                    href={localePath(`/canvas/${project.id}`)}
                    folders={sortedFolders}
                    onMove={(folderId) => moveProject(project.id, folderId)}
                    onDelete={() => deleteProject(project)}
                    folderDisplayName={(folder) => folderDisplayName(folder, t)}
                    moveToLabel={t('workspace.folders.moveTo')}
                    moveToRootLabel={t('workspace.folders.moveToRoot')}
                    deleteLabel={t('workspace.folders.deleteWorkflow')}
                    onWarm={warmCanvasDestination}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}

function FolderSidebarItem({
  icon,
  label,
  count,
  active,
  onClick,
  onRename,
  onDelete,
}: {
  icon: React.ReactNode;
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
  onRename?: () => void;
  onDelete?: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={onClick}
        className={cn(
          'group flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors',
          active
            ? 'bg-white/[0.08] text-white'
            : 'text-white/65 hover:bg-white/[0.05] hover:text-white',
        )}
      >
        <span className={cn('shrink-0', active ? 'text-white' : 'text-white/52')}>{icon}</span>
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium">{label}</span>
        <span className="text-[11px] text-white/35">{count}</span>
        {onRename || onDelete ? (
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((prev) => !prev);
            }}
            className="ml-0.5 flex h-5 w-5 items-center justify-center rounded text-white/35 opacity-0 transition-opacity hover:bg-white/[0.06] hover:text-white group-hover:opacity-100"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <IconDotsVertical size={13} stroke={2.2} />
          </button>
        ) : null}
      </button>
      {menuOpen ? (
        <motion.div
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.12, ease: [0.32, 0.72, 0, 1] }}
          className="absolute left-0 right-0 top-[calc(100%+4px)] z-30 flex flex-col gap-0.5 overflow-hidden rounded-lg bg-[#1c1d1f] p-1 shadow-[0_20px_60px_-30px_rgba(0,0,0,0.9)] ring-1 ring-white/[0.08]"
        >
          {onRename ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen(false);
                onRename();
              }}
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-white/82 hover:bg-white/[0.06] hover:text-white"
            >
              <IconPencil size={13} stroke={2.2} />
              <RenameLabel />
            </button>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen(false);
                onDelete();
              }}
              className="flex items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-[#ffabb6] hover:bg-[#ff5d73]/16"
            >
              <IconTrash size={13} stroke={2.2} />
              <DeleteLabel />
            </button>
          ) : null}
        </motion.div>
      ) : null}
    </div>
  );
}

function RenameLabel() {
  const { t } = useI18n();
  return <span>{t('workspace.folders.rename')}</span>;
}

function DeleteLabel() {
  const { t } = useI18n();
  return <span>{t('workspace.folders.remove')}</span>;
}

/**
 * 工作流卡片骨架。
 * - 整体结构与 ProjectCard 完全对齐（外框 padding、缩略图高度、标题/时间两行占位），
 *   这样真实数据切入时网格几乎不会跳动。
 * - `lumen-skeleton` 提供「呼吸 + 微光扫过」的双层动画，柔和不晃眼。
 */
function ProjectCardSkeleton() {
  return (
    <div
      className="overflow-hidden rounded-xl bg-[#1a1c1d] p-2.5 ring-1 ring-white/[0.05]"
      aria-hidden="true"
    >
      <div className="lumen-skeleton h-[116px] rounded-lg" />
      <div className="mt-2.5 flex items-start gap-2 px-0.5 pb-0.5">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="lumen-skeleton h-3 w-[62%] rounded" />
          <div className="lumen-skeleton h-2.5 w-[36%] rounded" />
        </div>
        <div className="lumen-skeleton h-7 w-7 shrink-0 rounded-lg" />
      </div>
    </div>
  );
}

/** 骨架卡片的渲染数量：在 xl 4 列下正好铺满 2 行，视觉刚好有"占位但不喧宾夺主"。 */
const PROJECT_SKELETON_COUNT = 8;

function NewProjectCard({ href, onWarm }: { href: string; onWarm: (href: string) => void }) {
  const { t } = useI18n();
  return (
    <Link
      href={href}
      prefetch={true}
      onFocus={() => onWarm(href)}
      onMouseDown={() => onWarm(href)}
      onPointerEnter={() => onWarm(href)}
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

function ProjectCard({
  project,
  href,
  folders,
  onMove,
  onDelete,
  folderDisplayName,
  moveToLabel,
  moveToRootLabel,
  deleteLabel,
  onWarm,
}: {
  project: StudioProject;
  href: string;
  folders: FolderRecord[];
  onMove: (folderId: string | null) => void;
  onDelete: () => void;
  folderDisplayName: (folder: FolderRecord) => string;
  moveToLabel: string;
  moveToRootLabel: string;
  deleteLabel: string;
  onWarm: (href: string) => void;
}) {
  const { t } = useI18n();
  const [menuOpen, setMenuOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setMenuOpen(false);
    };
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      if (event.key === 'Escape') setMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [menuOpen]);

  const stopPropagation = (event: React.MouseEvent | KeyboardEvent) => {
    event.stopPropagation();
  };

  return (
    <div ref={containerRef} className="relative">
      <Link
        href={href}
        prefetch={true}
        onFocus={() => onWarm(href)}
        onMouseDown={() => onWarm(href)}
        onPointerEnter={() => onWarm(href)}
        className="group block overflow-hidden rounded-xl bg-[#202121] p-2.5 text-left ring-1 ring-white/[0.08] transition-colors hover:bg-[#262829]"
      >
        <div
          className="relative h-[116px] overflow-hidden rounded-lg"
          style={project.thumbnail ? undefined : { background: project.cover }}
        >
          {project.thumbnail ? (
            <>
              <img
                src={project.thumbnail}
                alt=""
                className="absolute inset-0 h-full w-full object-cover"
              />
              <div className="absolute inset-0 opacity-40 mix-blend-soft-light [background-image:linear-gradient(120deg,transparent_20%,rgba(255,255,255,0.35)_48%,transparent_62%)]" />
            </>
          ) : project.coverMode === 'tutorial' ? (
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
          {!project.thumbnail && project.coverMode === 'soft' && (
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
          <button
            type="button"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setMenuOpen((prev) => !prev);
            }}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-white/35 transition-colors group-hover:bg-white/[0.06] group-hover:text-white/72"
          >
            <IconDotsVertical size={15} stroke={2.2} />
          </button>
        </div>
      </Link>

      {menuOpen ? (
        <motion.div
          initial={{ opacity: 0, y: -4, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.14, ease: [0.32, 0.72, 0, 1] }}
          className="absolute right-2 top-[calc(116px+12px)] z-40 w-[200px] overflow-hidden rounded-xl bg-[#1c1d1f] p-1 shadow-[0_24px_70px_-30px_rgba(0,0,0,0.92)] ring-1 ring-white/[0.08]"
          onClick={stopPropagation}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setMenuOpen(false);
          }}
        >
          <div className="px-2.5 pb-1 pt-1.5 text-[11px] font-bold uppercase tracking-wider text-white/35">
            {moveToLabel}
          </div>
          <MoveMenuItem
            label={moveToRootLabel}
            selected={!project.folderId}
            onClick={() => {
              setMenuOpen(false);
              if (project.folderId) onMove(null);
            }}
          />
          {folders.map((folder) => (
            <MoveMenuItem
              key={folder.id}
              label={folderDisplayName(folder)}
              selected={project.folderId === folder.id}
              onClick={() => {
                setMenuOpen(false);
                if (project.folderId !== folder.id) onMove(folder.id);
              }}
            />
          ))}
          <div className="my-1 h-px bg-white/[0.06]" />
          <button
            type="button"
            onClick={() => {
              setMenuOpen(false);
              onDelete();
            }}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-[#ffabb6] transition-colors hover:bg-[#ff5d73]/16 hover:text-[#ffc6cd]"
          >
            <IconTrash size={14} stroke={2.2} />
            <span className="truncate">{deleteLabel}</span>
          </button>
        </motion.div>
      ) : null}
    </div>
  );
}

function MoveMenuItem({
  label,
  selected,
  onClick,
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
        selected
          ? 'bg-white/[0.08] text-white'
          : 'text-white/72 hover:bg-white/[0.05] hover:text-white',
      )}
    >
      <span className="truncate">{label}</span>
      {selected ? <IconCheck size={13} stroke={2.6} className="text-[#9da8ff]" /> : null}
    </button>
  );
}

function folderDisplayName(
  folder: FolderRecord,
  t: (key: string, params?: Record<string, string | number | boolean | null | undefined>) => string,
): string {
  if (folder.systemKey === 'viral_remix') return t('workspace.folders.systemViralRemix');
  return folder.name;
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
    thumbnail: project.thumbnail,
    coverMode: project.thumbnail ? undefined : project.id.charCodeAt(0) % 3 === 0 ? 'soft' : undefined,
    folderId: project.folderId,
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
