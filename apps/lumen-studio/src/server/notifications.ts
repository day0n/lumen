import 'server-only';

import type { CreateOfficialNotificationInput, OfficialNotificationRecord } from '@lumen/db';

import { requireStudioUser } from './auth';
import { getNotificationRepository } from './db';
import { traceStudioStep } from './telemetry';

const DEFAULT_OFFICIAL_NOTIFICATIONS: CreateOfficialNotificationInput[] = [
  {
    id: 'agent-mode-launch-2026-05-26',
    title: 'Agent 模式正式上线',
    body: 'Lumen Agent 模式已开放使用。你可以从商品链接、产品卖点或参考视频开始，让 Agent 自动拆解脚本、镜头、素材和执行计划。当前版本会优先覆盖带货短视频的核心链路，后续会继续补齐更细的多角色协作能力。',
    publishedAt: new Date('2026-05-26T10:00:00.000+08:00'),
    sortOrder: 0,
  },
  {
    id: 'hot-video-remix-launch-2026-05-26',
    title: '爆款复刻功能上线',
    body: '爆款复刻现在可以作为独立入口使用。你可以浏览官方整理的高转化视频结构，也可以把参考内容拆成钩子、卖点、镜头节奏和改写方向，再带回自己的商品项目里生成可执行版本。',
    publishedAt: new Date('2026-05-26T09:30:00.000+08:00'),
    sortOrder: 1,
  },
  {
    id: 'materials-library-launch-2026-05-26',
    title: '素材库上线',
    body: '素材库已接入首页入口。第一阶段会用于集中管理商品图、参考视频、品牌元素和可复用镜头素材；后续会继续加入标签检索、向量召回和画布节点引用，让 Agent 在生成脚本时能主动挑选素材。',
    publishedAt: new Date('2026-05-26T09:00:00.000+08:00'),
    sortOrder: 2,
  },
];

let ensureDefaultNotificationsPromise: Promise<void> | null = null;

export interface OfficialNotificationsResponse {
  notifications: OfficialNotificationRecord[];
  unreadCount: number;
}

export async function listOfficialNotifications(): Promise<OfficialNotificationsResponse> {
  const user = await traceStudioStep('studio.auth.require_user', 'auth', requireStudioUser);
  const repository = await traceStudioStep(
    'studio.notifications.repository',
    'db.connect',
    getNotificationRepository,
  );
  await traceStudioStep('studio.notifications.ensure_defaults', 'db.write', () =>
    ensureDefaultNotifications(repository),
  );

  const notifications = await traceStudioStep('studio.notifications.list.db', 'db.query', () =>
    repository.listOfficialForUser(user.id),
  );
  return {
    notifications,
    unreadCount: notifications.filter((notification) => !notification.isRead).length,
  };
}

export async function markOfficialNotificationRead(notificationId: string): Promise<boolean> {
  const user = await traceStudioStep('studio.auth.require_user', 'auth', requireStudioUser);
  const repository = await traceStudioStep(
    'studio.notifications.repository',
    'db.connect',
    getNotificationRepository,
  );
  await traceStudioStep('studio.notifications.ensure_defaults', 'db.write', () =>
    ensureDefaultNotifications(repository),
  );
  return traceStudioStep('studio.notifications.mark_read.db', 'db.write', () =>
    repository.markOfficialRead(user.id, notificationId),
  );
}

function ensureDefaultNotifications(
  repository: Awaited<ReturnType<typeof getNotificationRepository>>,
) {
  ensureDefaultNotificationsPromise ??= repository.ensureDefaultOfficialNotifications(
    DEFAULT_OFFICIAL_NOTIFICATIONS,
  );
  return ensureDefaultNotificationsPromise;
}
