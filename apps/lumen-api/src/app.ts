import {
  type AuthenticatedUser,
  type NotificationService,
  type ProjectDetailQueryService,
  type ProjectQueryService,
  UnauthorizedError,
  UserProvisioningRequiredError,
  type UserRecordPort,
  type WorkflowStatusQueryService,
  apiFailure,
  apiSuccess,
  parseProjectListSearchParams,
  parseWorkflowStatusNodeIds,
} from '@lumen/backend';
import {
  ListProjectsInputSchema,
  type OfficialNotificationRecord,
  type ProjectListRecord,
  type ProjectRecord,
} from '@lumen/db';
import { type Context, Hono } from 'hono';

import { DEFAULT_API_READINESS_TIMEOUT_MS, MAX_TIMER_TIMEOUT_MS } from './config.js';
import type { ApiEnv } from './http/context-middleware.js';
import { requestContextMiddleware } from './http/context-middleware.js';
import { type SessionCredential, readSessionCredential } from './http/session-token.js';

export type ReadinessChecks = Record<string, boolean>;

export interface HomeQueries {
  listFeatured(locale: 'en' | 'zh'): Promise<unknown[]>;
  listTemplates(locale: 'en' | 'zh'): Promise<unknown>;
}

export interface AuthenticatedUsers<TUser extends UserRecordPort = UserRecordPort> {
  requireUser(token: string | null | undefined): Promise<AuthenticatedUser<TUser>>;
}

export interface CreateApiAppOptions {
  authenticatedUsers?: AuthenticatedUsers;
  homeQueries?: HomeQueries;
  notifications?: NotificationService<OfficialNotificationRecord>;
  projectDetails?: ProjectDetailQueryService<ProjectRecord>;
  projectQueries?: ProjectQueryService<ProjectListRecord>;
  workflowStatusQueries?: WorkflowStatusQueryService;
  release?: string;
  readiness?: () => Promise<ReadinessChecks> | ReadinessChecks;
  readinessTimeoutMs?: number;
  requiredReadinessChecks?: readonly string[];
  trustedCookieOrigins?: readonly string[];
}

export function createApiApp(options: CreateApiAppOptions = {}) {
  const release = options.release ?? 'dev';
  const readiness = options.readiness ?? (() => ({ bootstrap: true }));
  const readinessTimeoutMs = readPositiveTimeout(
    options.readinessTimeoutMs ?? DEFAULT_API_READINESS_TIMEOUT_MS,
  );
  const requiredReadinessChecks = options.requiredReadinessChecks;
  const trustedCookieOrigins = new Set(options.trustedCookieOrigins ?? []);
  const app = new Hono<ApiEnv>();

  app.use('*', requestContextMiddleware());
  app.use('*', async (context, next) => {
    await next();
    context.header('x-lumen-release', release);
  });

  app.get('/healthz', (context) => {
    context.header('cache-control', 'no-store');
    return context.json({
      ok: true as const,
      service: 'lumen-api',
      release,
      ts: Date.now(),
    });
  });

  app.get('/readyz', async (context) => {
    context.header('cache-control', 'no-store');
    let checks: ReadinessChecks;
    try {
      checks = await readinessBeforeDeadline(readiness, readinessTimeoutMs);
    } catch {
      checks = { readinessExecution: false };
    }
    const ready = requiredReadinessChecks
      ? requiredReadinessChecks.length > 0 &&
        requiredReadinessChecks.every((name) => checks[name] === true)
      : Object.values(checks).length > 0 && Object.values(checks).every(Boolean);
    return context.json(
      {
        ok: ready,
        service: 'lumen-api',
        release,
        checks,
        ts: Date.now(),
      },
      ready ? 200 : 503,
    );
  });

  app.get('/api/me', async (context) => {
    return withAuthenticatedRoute(
      context,
      options.authenticatedUsers,
      'GET /api/me',
      (authenticated) => context.json(apiSuccess({ user: authenticated.user })),
    );
  });

  app.get('/api/notifications/official', async (context) => {
    return withAuthenticatedRoute(
      context,
      options.authenticatedUsers,
      'GET /api/notifications/official',
      async (authenticated) => {
        const requestContext = context.get('requestContext');
        if (!options.notifications) {
          return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 503);
        }

        const result = await options.notifications.listOfficial(
          authenticated.actor.userId,
          requestContext.locale,
        );
        return context.json(apiSuccess(result));
      },
    );
  });

  app.get('/api/projects', async (context) => {
    return withAuthenticatedRoute(
      context,
      options.authenticatedUsers,
      'GET /api/projects',
      async (authenticated) => {
        const requestContext = context.get('requestContext');
        if (!options.projectQueries) {
          return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 503);
        }

        const parsed = ListProjectsInputSchema.safeParse({
          ownerId: authenticated.actor.userId,
          ...parseProjectListSearchParams(new URL(context.req.url).searchParams),
        });
        if (!parsed.success) {
          return context.json(
            apiFailure(invalidRequestMessage(requestContext.locale), parsed.error.flatten()),
            400,
          );
        }

        const projects = await options.projectQueries.listProjects(authenticated.actor.userId, {
          folderId: parsed.data.folderId,
          limit: parsed.data.limit,
          query: parsed.data.query,
        });
        return context.json(apiSuccess({ projects }));
      },
    );
  });

  app.get('/api/projects/:projectId', async (context) => {
    return withAuthenticatedRoute(
      context,
      options.authenticatedUsers,
      'GET /api/projects/:projectId',
      async (authenticated) => {
        const requestContext = context.get('requestContext');
        if (!options.projectDetails) {
          return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 503);
        }

        const projectId = context.req.param('projectId');
        if (!projectId.trim()) {
          return context.json(apiFailure(projectNotFoundMessage(requestContext.locale)), 404);
        }

        const project = await options.projectDetails.getProject(
          authenticated.actor.userId,
          projectId,
          {
            bypassCache: new URL(context.req.url).searchParams.get('fresh') === '1',
          },
        );
        if (!project) {
          return context.json(apiFailure(projectNotFoundMessage(requestContext.locale)), 404);
        }

        return context.json(apiSuccess({ project }));
      },
    );
  });

  app.get('/api/projects/:projectId/workflow-status', async (context) => {
    return withAuthenticatedRoute(
      context,
      options.authenticatedUsers,
      'GET /api/projects/:projectId/workflow-status',
      async (authenticated) => {
        const requestContext = context.get('requestContext');
        if (!options.workflowStatusQueries) {
          return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 503);
        }

        const projectId = context.req.param('projectId');
        if (!projectId.trim()) {
          return context.json(apiFailure(projectNotFoundMessage(requestContext.locale)), 404);
        }

        const nodeIds = parseWorkflowStatusNodeIds(
          new URL(context.req.url).searchParams.get('nodeIds'),
        );
        const results = await options.workflowStatusQueries.getNodeResults(
          authenticated.actor.userId,
          projectId,
          nodeIds,
        );
        if (!results) {
          return context.json(apiFailure(projectNotFoundMessage(requestContext.locale)), 404);
        }

        return context.json(apiSuccess({ results }));
      },
    );
  });

  app.post('/api/notifications/official/:notificationId/read', async (context) => {
    return withAuthenticatedRoute(
      context,
      options.authenticatedUsers,
      'POST /api/notifications/official/:notificationId/read',
      async (authenticated, credentialSource) => {
        const requestContext = context.get('requestContext');
        if (
          credentialSource !== 'bearer' &&
          !trustedCookieOrigins.has(context.req.header('origin') ?? '')
        ) {
          return context.json(
            apiFailure(
              invalidRequestOriginMessage(requestContext.locale),
              undefined,
              'INVALID_REQUEST_ORIGIN',
            ),
            403,
          );
        }

        const notificationId = context.req.param('notificationId');
        if (!isValidNotificationId(notificationId)) {
          return context.json(
            apiFailure(
              invalidNotificationIdMessage(requestContext.locale),
              undefined,
              'INVALID_NOTIFICATION_ID',
            ),
            400,
          );
        }
        if (!options.notifications) {
          return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 503);
        }

        const updated = await options.notifications.markOfficialRead(
          authenticated.actor.userId,
          notificationId,
        );
        if (!updated) {
          return context.json(
            apiFailure(
              notificationNotFoundMessage(requestContext.locale),
              undefined,
              'NOTIFICATION_NOT_FOUND',
            ),
            404,
          );
        }

        return context.json(apiSuccess({ read: true as const }));
      },
    );
  });

  app.get('/api/home/featured', async (context) => {
    const requestContext = context.get('requestContext');
    if (!options.homeQueries) {
      return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 503);
    }
    try {
      const items = await options.homeQueries.listFeatured(requestContext.locale);
      return context.json({ ok: true as const, data: { items } });
    } catch (error) {
      logRouteError('GET /api/home/featured', requestContext.requestId, error);
      return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 500);
    }
  });

  app.get('/api/home/templates', async (context) => {
    const requestContext = context.get('requestContext');
    if (!options.homeQueries) {
      return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 503);
    }
    try {
      const templates = await options.homeQueries.listTemplates(requestContext.locale);
      return context.json({ ok: true as const, data: templates });
    } catch (error) {
      logRouteError('GET /api/home/templates', requestContext.requestId, error);
      return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 500);
    }
  });

  app.notFound((context) => context.json(apiFailure('Not found', undefined, 'NOT_FOUND'), 404));

  app.onError((error, context) => {
    const requestId = context.get('requestContext')?.requestId;
    console.error('[lumen-api] unhandled request error', { requestId, error });
    return context.json(apiFailure('Internal server error', undefined, 'INTERNAL_ERROR'), 500);
  });

  return app;
}

type CredentialSource = SessionCredential['source'];

async function withAuthenticatedRoute(
  context: Context<ApiEnv>,
  authenticatedUsers: AuthenticatedUsers | undefined,
  route: string,
  handler: (
    authenticated: AuthenticatedUser<UserRecordPort>,
    credentialSource: CredentialSource | null,
  ) => Response | Promise<Response>,
): Promise<Response> {
  context.header('cache-control', 'private, no-store');
  const requestContext = context.get('requestContext');
  if (!authenticatedUsers) {
    return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 503);
  }

  const credential = readSessionCredential(context.req.raw);
  try {
    const authenticated = await authenticatedUsers.requireUser(credential?.token);
    requestContext.actor = authenticated.actor;
    return await handler(authenticated, credential?.source ?? null);
  } catch (error) {
    if (error instanceof UnauthorizedError) {
      return context.json(apiFailure(unauthorizedMessage(requestContext.locale)), 401);
    }
    if (error instanceof UserProvisioningRequiredError) {
      return context.json(
        apiFailure(
          internalErrorMessage(requestContext.locale),
          undefined,
          'USER_PROVISIONING_REQUIRED',
        ),
        503,
      );
    }
    logRouteError(route, requestContext.requestId, error);
    return context.json(apiFailure(internalErrorMessage(requestContext.locale)), 500);
  }
}

function isValidNotificationId(notificationId: string | undefined): notificationId is string {
  if (!notificationId || notificationId.length > 120 || notificationId !== notificationId.trim()) {
    return false;
  }

  for (const character of notificationId) {
    const codePoint = character.codePointAt(0);
    if (
      character === '/' ||
      character === '\\' ||
      codePoint === undefined ||
      codePoint <= 0x1f ||
      codePoint === 0x7f
    ) {
      return false;
    }
  }
  return true;
}

function internalErrorMessage(locale: 'en' | 'zh') {
  return locale === 'zh' ? '服务暂时不可用' : 'Internal server error';
}

function unauthorizedMessage(locale: 'en' | 'zh') {
  return locale === 'zh' ? '请先登录' : 'Please sign in first';
}

function invalidRequestOriginMessage(locale: 'en' | 'zh') {
  return locale === 'zh' ? '请求来源无效' : 'Invalid request origin';
}

function invalidRequestMessage(locale: 'en' | 'zh') {
  return locale === 'zh' ? '请求数据不符合约束' : 'Request data does not match the expected shape';
}

function invalidNotificationIdMessage(locale: 'en' | 'zh') {
  return locale === 'zh' ? '通知 ID 无效' : 'Invalid notification ID';
}

function notificationNotFoundMessage(locale: 'en' | 'zh') {
  return locale === 'zh' ? '通知不存在' : 'Notification not found';
}

function projectNotFoundMessage(locale: 'en' | 'zh') {
  return locale === 'zh' ? '项目不存在' : 'Project not found';
}

function logRouteError(route: string, requestId: string, error: unknown) {
  console.error('[lumen-api] route failed', { route, requestId, error });
}

function readPositiveTimeout(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_TIMER_TIMEOUT_MS) {
    throw new Error(`readinessTimeoutMs must be an integer between 1 and ${MAX_TIMER_TIMEOUT_MS}`);
  }
  return value;
}

async function readinessBeforeDeadline(
  readiness: () => Promise<ReadinessChecks> | ReadinessChecks,
  timeoutMs: number,
): Promise<ReadinessChecks> {
  const deadline = Symbol('readiness-deadline');
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      Promise.resolve().then(readiness),
      new Promise<typeof deadline>((resolve) => {
        timer = setTimeout(() => resolve(deadline), timeoutMs);
      }),
    ]);
    return result === deadline ? { readinessDeadline: false } : result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
