import 'server-only';

import type { HomeWorkflowTemplateListRecord, ProjectCanvas, ProjectRecord } from '@lumen/db';
import { z } from 'zod';

import type { Locale } from '@/i18n/routing';
import { getHomeWorkflowTemplateRepository } from './db';
import { getStudioHomeQueryService } from './homeQueries';
import { createStudioProject } from './projects';

const CloneTemplateIdSchema = z.string().trim().min(1).max(120);

export async function listHomeWorkflowTemplates(
  locale: Locale = 'en',
): Promise<HomeWorkflowTemplateListRecord> {
  return getStudioHomeQueryService().listTemplates(locale);
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
  await getStudioHomeQueryService().invalidateTemplates();
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
