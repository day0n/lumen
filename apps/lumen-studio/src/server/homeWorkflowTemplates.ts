import 'server-only';

import {
  type HomeWorkflowTemplateListRecord,
  HomeWorkflowTemplateListRecordSchema,
  type ProjectCanvas,
  type ProjectRecord,
} from '@lumen/db';
import { z } from 'zod';

import type { Locale } from '@/i18n/routing';
import { getHomeWorkflowTemplateRepository, getStudioCache } from './db';
import { createStudioProject } from './projects';
import { traceStudioStep } from './telemetry';

const HOME_WORKFLOW_TEMPLATES_CACHE_KEY_PREFIX = 'home:workflow-templates:v1';
const HOME_WORKFLOW_TEMPLATES_CACHE_TTL_SECONDS = 300;
const HOME_WORKFLOW_TEMPLATES_PER_CATEGORY = 9;

const CloneTemplateIdSchema = z.string().trim().min(1).max(120);

export async function listHomeWorkflowTemplates(
  locale: Locale = 'en',
): Promise<HomeWorkflowTemplateListRecord> {
  const cache = getStudioCache();
  const cacheKey = `${HOME_WORKFLOW_TEMPLATES_CACHE_KEY_PREFIX}:${locale}`;
  const cached = await traceStudioStep('studio.home.templates.cache_get', 'cache.get', () =>
    cache.get(cacheKey, HomeWorkflowTemplateListRecordSchema),
  );
  if (cached) return cached;

  const repository = await traceStudioStep(
    'studio.home.templates.repository',
    'db.connect',
    getHomeWorkflowTemplateRepository,
  );
  const templates = await traceStudioStep('studio.home.templates.db', 'db.query', () =>
    repository.listActive({
      locale,
      perCategory: HOME_WORKFLOW_TEMPLATES_PER_CATEGORY,
    }),
  );

  await traceStudioStep('studio.home.templates.cache_set', 'cache.set', () =>
    cache.set(cacheKey, templates, HOME_WORKFLOW_TEMPLATES_CACHE_TTL_SECONDS),
  );
  return templates;
}

export async function cloneHomeWorkflowTemplate(
  templateId: string,
  locale: Locale = 'en',
): Promise<ProjectRecord | null> {
  const parsedTemplateId = CloneTemplateIdSchema.parse(templateId);
  const repository = await getHomeWorkflowTemplateRepository();
  const template = await repository.getActive(parsedTemplateId, locale);
  if (!template) return null;

  const project = await createStudioProject({
    title: template.title,
    description: template.description,
    thumbnail: template.coverUrl,
    canvas: normalizeTemplateCanvas(template.canvas),
  });

  await repository.incrementUsage(parsedTemplateId);
  await invalidateHomeWorkflowTemplatesCache();
  return project;
}

export async function invalidateHomeWorkflowTemplatesCache(): Promise<void> {
  await Promise.all([
    getStudioCache().delete(`${HOME_WORKFLOW_TEMPLATES_CACHE_KEY_PREFIX}:en`),
    getStudioCache().delete(`${HOME_WORKFLOW_TEMPLATES_CACHE_KEY_PREFIX}:zh`),
  ]);
}

function normalizeTemplateCanvas(canvas: ProjectCanvas): ProjectCanvas {
  return {
    ...canvas,
    edges: canvas.edges.map((edge) => ({
      ...edge,
      type: 'lumenSmooth',
      selectable: typeof edge.selectable === 'boolean' ? edge.selectable : true,
      reconnectable: typeof edge.reconnectable === 'boolean' ? edge.reconnectable : true,
      data: edge.data ?? {},
    })),
  };
}
