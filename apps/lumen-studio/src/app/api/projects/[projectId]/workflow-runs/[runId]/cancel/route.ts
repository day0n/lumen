import { getRedisClient } from '@lumen/db';
import { z } from 'zod';

import { translate } from '@/i18n/messages';
import { requireStudioUser } from '@/server/auth';
import { getStudioServerConfig } from '@/server/config';
import { getProjectRepository } from '@/server/db';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { StreamPublisher } from '@/server/ws/stream-publisher';

export const runtime = 'nodejs';

const CancelWorkflowRunBodySchema = z
  .object({
    nodeIds: z.array(z.string().trim().min(1).max(64)).max(200).optional(),
    reason: z.string().trim().max(160).optional(),
  })
  .strict();

interface CancelWorkflowRunContext {
  params: Promise<{ projectId: string; runId: string }>;
}

export const POST = withApiRouteSpan(
  'POST /api/projects/:projectId/workflow-runs/:runId/cancel',
  async (request: Request, context: CancelWorkflowRunContext) => {
    const locale = resolveRequestLocale(request);
    try {
      const { projectId, runId } = await context.params;
      if (!projectId || !runId) return failJson(translate(locale, 'api.invalidRequest'), 400);

      const body = CancelWorkflowRunBodySchema.parse(await readJson(request));
      const user = await requireStudioUser(request);
      const repository = await getProjectRepository();
      const project = await repository.get(user.id, projectId);
      if (!project) return failJson(translate(locale, 'api.projectNotFound'), 404);

      const requestedNodeIds = new Set(body.nodeIds ?? []);
      const activeNodes = project.canvas.nodes.filter((node) => {
        if (requestedNodeIds.size > 0 && !requestedNodeIds.has(node.id)) return false;
        const activeRunId =
          typeof node.data.activeRunId === 'string' && node.data.activeRunId.trim()
            ? node.data.activeRunId
            : null;
        return activeRunId === runId;
      });
      if (activeNodes.length === 0) {
        return failJson(
          locale === 'zh'
            ? '没有找到这个项目里正在运行的节点'
            : 'No active workflow node found for this project run.',
          404,
        );
      }

      const config = getStudioServerConfig();
      const redis = getRedisClient({ url: config.REDIS_URL });
      if (!redis) {
        return failJson(
          locale === 'zh' ? '工作流取消服务未配置' : 'Workflow cancel service is not configured.',
          503,
        );
      }

      await new StreamPublisher(redis).cancelRun(runId, body.reason);
      return okJson({
        run_id: runId,
        node_ids: activeNodes.map((node) => node.id),
      });
    } catch (error) {
      return routeError(error, locale);
    }
  },
);
