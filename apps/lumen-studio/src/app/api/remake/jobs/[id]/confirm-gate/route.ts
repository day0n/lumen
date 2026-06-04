import { requireStudioUser } from '@/server/auth';
import { failJson, okJson, readJson, routeError, withApiRouteSpan } from '@/server/http';
import { resolveRequestLocale } from '@/server/locale';
import { confirmGate1, confirmGate2 } from '@/server/remake/jobs';
import { z } from 'zod';

export const runtime = 'nodejs';
export const maxDuration = 200;

const Gate1Body = z
  .object({
    gate: z.literal('gate1'),
    scriptText: z.string().trim().min(1).max(8000),
    sellingPoints: z.array(z.string().trim().min(1).max(120)).max(8).default([]),
    audienceTags: z.array(z.string().trim().min(1).max(80)).max(8).default([]),
    voiceLanguage: z.enum(['zh', 'en']).optional(),
  })
  .strict();

const Gate2Body = z
  .object({
    gate: z.literal('gate2'),
  })
  .strict();

const Body = z.discriminatedUnion('gate', [Gate1Body, Gate2Body]);

export const POST = withApiRouteSpan(
  'POST /api/remake/jobs/[id]/confirm-gate',
  async (request: Request, context: { params: Promise<{ id: string }> }) => {
    const locale = resolveRequestLocale(request);
    try {
      const { id } = await context.params;
      const body = Body.parse(await readJson(request));
      const user = await requireStudioUser();

      if (body.gate === 'gate1') {
        const view = await confirmGate1({
          jobId: id,
          ownerId: user.id,
          scriptText: body.scriptText,
          sellingPoints: body.sellingPoints,
          audienceTags: body.audienceTags,
          voiceLanguage: body.voiceLanguage,
          locale,
        });
        if (!view) {
          return failJson(locale === 'zh' ? '复刻任务不存在' : 'Remake job not found', 404);
        }
        return okJson(view);
      }

      const view = await confirmGate2({ jobId: id, ownerId: user.id });
      if (!view) {
        return failJson(locale === 'zh' ? '复刻任务不存在' : 'Remake job not found', 404);
      }
      return okJson(view);
    } catch (error) {
      if (error instanceof SyntaxError) {
        return failJson(locale === 'zh' ? '请求 JSON 无效' : 'Invalid JSON', 400);
      }
      if (error instanceof Error && error.message.includes('Gate 1')) {
        return failJson(error.message, 409);
      }
      return routeError(error, locale);
    }
  },
);
