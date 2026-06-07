'use client';

import { useI18n } from '@/i18n/provider';
import { useLoginRedirect } from '@/lib/auth-redirect';
import {
  IconArrowRight,
  IconLoader2,
  IconPlayerPlay,
  IconSearch,
  IconSparkles,
} from '@tabler/icons-react';
import { motion } from 'motion/react';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useState } from 'react';

interface TemplateCategory {
  id: string;
  label: string;
  sortOrder: number;
  count: number;
}

interface WorkflowTemplate {
  id: string;
  categoryId: string;
  categoryLabel: string;
  title: string;
  subtitle: string;
  description: string;
  badge: string;
  tags: string[];
  coverUrl: string;
  mediaType: 'image' | 'video';
  usageCount: number;
  lastRunAt: string;
}

type HomeTemplatesApiResponse =
  | {
      ok: true;
      data: {
        categories: TemplateCategory[];
        items: WorkflowTemplate[];
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

type CloneTemplateApiResponse =
  | {
      ok: true;
      data: {
        project: {
          id: string;
        };
      };
    }
  | {
      ok: false;
      error: {
        message: string;
      };
    };

const ALL_CATEGORY_ID = 'all';
const SKELETON_TEMPLATE_IDS = [
  'template-skeleton-1',
  'template-skeleton-2',
  'template-skeleton-3',
  'template-skeleton-4',
  'template-skeleton-5',
  'template-skeleton-6',
  'template-skeleton-7',
  'template-skeleton-8',
];

export function TemplateRail() {
  const router = useRouter();
  const { locale, t, localePath } = useI18n();
  const { requireLogin } = useLoginRedirect();
  const [categories, setCategories] = useState<TemplateCategory[]>([]);
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([]);
  const [activeCategory, setActiveCategory] = useState(ALL_CATEGORY_ID);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [readFailed, setReadFailed] = useState(false);
  const [cloneFailed, setCloneFailed] = useState(false);
  const [openingTemplateId, setOpeningTemplateId] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function loadTemplates() {
      setLoading(true);
      setReadFailed(false);
      try {
        const response = await fetch('/api/home/templates', {
          signal: controller.signal,
          headers: { 'x-lumen-locale': locale },
        });
        const payload = (await response.json()) as HomeTemplatesApiResponse;
        if (!response.ok) throw new Error('read failed');
        if (!payload.ok) throw new Error(payload.error.message);
        setCategories(payload.data.categories);
        setTemplates(payload.data.items);
      } catch (error) {
        if (!controller.signal.aborted) {
          console.error(error);
          setReadFailed(true);
          setCategories([]);
          setTemplates([]);
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }

    void loadTemplates();
    return () => controller.abort();
  }, [locale]);

  useEffect(() => {
    if (
      activeCategory !== ALL_CATEGORY_ID &&
      !categories.some((category) => category.id === activeCategory)
    ) {
      setActiveCategory(ALL_CATEGORY_ID);
    }
  }, [activeCategory, categories]);

  const filteredTemplates = useMemo(() => {
    const normalizedQuery = normalizeSearch(query);
    return templates.filter((template) => {
      if (activeCategory !== ALL_CATEGORY_ID && template.categoryId !== activeCategory) {
        return false;
      }
      if (!normalizedQuery) return true;
      const haystack = normalizeSearch(
        [
          template.title,
          template.subtitle,
          template.description,
          template.categoryLabel,
          template.badge,
          ...template.tags,
        ].join(' '),
      );
      return haystack.includes(normalizedQuery);
    });
  }, [activeCategory, query, templates]);

  const categoryTabs = useMemo(
    () => [
      {
        id: ALL_CATEGORY_ID,
        label: t('home.templateAll'),
        count: templates.length,
      },
      ...categories.map((category) => ({
        id: category.id,
        label: category.label,
        count: category.count,
      })),
    ],
    [categories, t, templates.length],
  );

  const openTemplate = async (template: WorkflowTemplate) => {
    setCloneFailed(false);
    if (!requireLogin()) return;
    setOpeningTemplateId(template.id);
    try {
      const response = await fetch(`/api/home/templates/${encodeURIComponent(template.id)}/clone`, {
        method: 'POST',
        headers: { 'x-lumen-locale': locale },
      });
      const payload = (await response.json()) as CloneTemplateApiResponse;
      if (!response.ok) throw new Error('clone failed');
      if (!payload.ok) throw new Error(payload.error.message);
      router.push(localePath(`/canvas/${payload.data.project.id}`));
    } catch (error) {
      console.error(error);
      setCloneFailed(true);
    } finally {
      setOpeningTemplateId(null);
    }
  };

  return (
    <section className="mx-auto mt-14 max-w-[1260px] px-6 pb-20">
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="mr-4 text-[20px] font-bold text-white">{t('home.templatesTitle')}</h2>
        <div className="flex flex-wrap gap-2">
          {categoryTabs.map((category) => {
            const active = category.id === activeCategory;
            return (
              <button
                key={category.id}
                type="button"
                onClick={() => setActiveCategory(category.id)}
                className={
                  active
                    ? 'inline-flex h-8 items-center gap-1.5 rounded-lg bg-white px-3 text-[12px] font-semibold text-[#111315]'
                    : 'inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/[0.045] px-3 text-[12px] text-white/56 ring-1 ring-white/[0.06] transition-colors hover:bg-white/[0.08] hover:text-white'
                }
              >
                <span>{category.label}</span>
                <span className={active ? 'text-black/48' : 'text-white/30'}>{category.count}</span>
              </button>
            );
          })}
        </div>

        <div className="ml-auto flex h-10 min-w-[260px] items-center gap-2 rounded-xl bg-[#141619] px-3 ring-1 ring-white/[0.08]">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('home.templateSearch')}
            className="min-w-0 flex-1 bg-transparent text-[13px] text-white outline-none placeholder:text-white/30"
          />
          <IconSearch size={17} className="text-white/40" stroke={2.1} />
        </div>
      </div>

      {cloneFailed ? (
        <div className="mb-4 rounded-lg bg-red-500/10 px-3 py-2 text-[12px] text-red-100 ring-1 ring-red-300/20">
          {t('home.templateCloneFailed')}
        </div>
      ) : null}

      {loading ? (
        <TemplateSkeletonGrid />
      ) : readFailed ? (
        <TemplateEmptyState label={t('home.templateReadFailed')} />
      ) : filteredTemplates.length === 0 ? (
        <TemplateEmptyState label={t('home.templateEmpty')} />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {filteredTemplates.map((template, index) => (
            <WorkflowTemplateCard
              key={template.id}
              index={index}
              loading={openingTemplateId === template.id}
              template={template}
              onOpen={() => void openTemplate(template)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

function WorkflowTemplateCard({
  template,
  index,
  loading,
  onOpen,
}: {
  template: WorkflowTemplate;
  index: number;
  loading: boolean;
  onOpen: () => void;
}) {
  return (
    <motion.button
      type="button"
      onClick={onOpen}
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.45, delay: index * 0.018, ease: [0.32, 0.72, 0, 1] }}
      className="group overflow-hidden rounded-xl bg-[#1d1f21] text-left ring-1 ring-black/45 transition-colors hover:bg-[#24272a]"
    >
      <div className="relative aspect-[4/3] overflow-hidden bg-black">
        <TemplateCover template={template} />
        <div className="pointer-events-none absolute inset-0 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.62),inset_0_0_30px_rgba(0,0,0,0.3)]" />
        <div className="absolute inset-0 bg-[linear-gradient(180deg,rgba(0,0,0,0.06)_0%,transparent_38%,rgba(0,0,0,0.76)_100%)]" />
        <div className="absolute left-3 top-3 max-w-[calc(100%-5.5rem)] truncate rounded-full bg-black/46 px-2.5 py-1 text-[11px] font-semibold text-white/86 backdrop-blur">
          {template.badge}
        </div>
        <div className="absolute right-3 top-3 inline-flex items-center gap-1 rounded-full bg-black/46 px-2.5 py-1 text-[11px] font-semibold uppercase text-white/78 backdrop-blur">
          {template.mediaType === 'video' ? <IconPlayerPlay size={11} stroke={2.4} /> : null}
          {template.mediaType}
        </div>
        <div className="absolute inset-x-3 bottom-3">
          <div className="mb-2 flex items-center gap-2 text-[11px] text-white/78">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-white/16">
              <IconSparkles size={13} stroke={2.2} />
            </span>
            <span className="min-w-0 flex-1 truncate">{template.categoryLabel}</span>
            <span className="rounded-full bg-white/14 px-2 py-0.5 text-white/78">
              {formatRunDate(template.lastRunAt)}
            </span>
          </div>
          <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug text-white">
            {template.title}
          </h3>
        </div>
      </div>

      <div className="flex min-h-[86px] items-start gap-3 px-3.5 py-3">
        <div className="min-w-0 flex-1">
          <p className="line-clamp-1 text-[12px] font-medium text-white/62">{template.subtitle}</p>
          <p className="mt-1.5 line-clamp-2 text-[12px] leading-relaxed text-white/38">
            {template.description}
          </p>
        </div>
        <span className="mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-white/[0.055] text-white/45 transition-colors group-hover:text-white">
          {loading ? (
            <IconLoader2 size={15} className="animate-spin" stroke={2.3} />
          ) : (
            <IconArrowRight size={15} stroke={2.3} />
          )}
        </span>
      </div>
    </motion.button>
  );
}

function TemplateCover({ template }: { template: WorkflowTemplate }) {
  const coverMediaClass =
    'absolute -inset-8 h-[calc(100%+4rem)] w-[calc(100%+4rem)] object-cover transition-transform duration-500 group-hover:scale-[1.02]';

  if (template.mediaType === 'video' && !isStaticImageUrl(template.coverUrl)) {
    return (
      <video
        aria-label={template.title}
        autoPlay
        className={coverMediaClass}
        loop
        muted
        playsInline
        preload="metadata"
        src={template.coverUrl}
      />
    );
  }

  return (
    <img
      alt={template.title}
      className={coverMediaClass}
      draggable={false}
      loading="lazy"
      src={template.coverUrl}
    />
  );
}

function isStaticImageUrl(value: string) {
  return /\.(avif|gif|jpe?g|png|webp)(?:[?#].*)?$/i.test(value);
}

function TemplateSkeletonGrid() {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {SKELETON_TEMPLATE_IDS.map((id) => (
        <div key={id} className="overflow-hidden rounded-xl bg-[#1d1f21] ring-1 ring-white/[0.06]">
          <div className="aspect-[4/3] animate-pulse bg-white/[0.055]" />
          <div className="space-y-2 px-3.5 py-3">
            <div className="h-3 w-2/3 rounded-full bg-white/[0.07]" />
            <div className="h-3 w-full rounded-full bg-white/[0.045]" />
            <div className="h-3 w-4/5 rounded-full bg-white/[0.045]" />
          </div>
        </div>
      ))}
    </div>
  );
}

function TemplateEmptyState({ label }: { label: string }) {
  return (
    <div className="flex min-h-[220px] items-center justify-center rounded-xl bg-white/[0.035] text-[13px] text-white/45 ring-1 ring-white/[0.06]">
      {label}
    </div>
  );
}

function normalizeSearch(value: string) {
  return value.trim().toLocaleLowerCase();
}

function formatRunDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleDateString(undefined, { month: 'numeric', day: 'numeric' });
}
