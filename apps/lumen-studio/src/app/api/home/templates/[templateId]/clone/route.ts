import { translate } from '@/i18n/messages';
import { cloneHomeWorkflowTemplate } from '@/server/homeWorkflowTemplates';
import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';

export const runtime = 'nodejs';

interface TemplateCloneRouteContext {
  params: Promise<{
    templateId: string;
  }>;
}

export const POST = withApiRouteSpan(
  'POST /api/home/templates/:templateId/clone',
  async (request: Request, context: TemplateCloneRouteContext) => {
    const locale = resolveRequestLocale(request);
    try {
      const { templateId } = await context.params;
      const project = await cloneHomeWorkflowTemplate(templateId, locale);

      if (!project) {
        return failJson(translate(locale, 'api.templateNotFound'), 404);
      }

      return okJson({ project }, { status: 201 });
    } catch (error) {
      return routeError(error, locale);
    }
  },
);
