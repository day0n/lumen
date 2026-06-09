import { translate } from '@/i18n/messages';
import { failJson, okJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { getStudioWorkflowNodeStatus } from '@/server/workflow-status';

export const runtime = 'nodejs';

interface WorkflowStatusRouteContext {
  params: Promise<{
    projectId: string;
  }>;
}

// Cap how many node ids we accept per request. The query goes into a Mongo
// `$in` against `workflow_node_results`; without a bound a malicious or
// broken client can send thousands of ids in a single URL (HTTP allows
// 8KB+ URLs) and force a heavy index scan that competes with other queries.
// 200 is enough to cover a fully-loaded canvas with margin.
const MAX_NODE_IDS = 200;
// Defence against absurd id length, mirrors the canvas node id format.
const MAX_NODE_ID_LENGTH = 64;

export const GET = withApiRouteSpan(
  'GET /api/projects/:projectId/workflow-status',
  async (request: Request, context: WorkflowStatusRouteContext) => {
    const locale = resolveRequestLocale(request);
    try {
      const { projectId } = await context.params;
      const raw = new URL(request.url).searchParams.get('nodeIds')?.split(',') ?? [];
      const nodeIds = raw
        .map((id) => id.trim())
        .filter((id) => id.length > 0 && id.length <= MAX_NODE_ID_LENGTH)
        .slice(0, MAX_NODE_IDS);
      const results = await getStudioWorkflowNodeStatus(projectId, nodeIds);
      return okJson({ results });
    } catch (error) {
      if (error instanceof Error && error.message === 'project not found') {
        return failJson(translate(locale, 'api.projectNotFound'), 404);
      }
      return routeError(error, locale);
    }
  },
);
