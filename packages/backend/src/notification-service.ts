import type { TraceStep } from './home-query-service.js';

export type NotificationLocale = 'en' | 'zh';

export interface OfficialNotificationTranslationSeed {
  title?: string;
  body?: string;
}

export interface OfficialNotificationSeed {
  id?: string;
  title: string;
  body: string;
  translations?: {
    en?: OfficialNotificationTranslationSeed;
    zh?: OfficialNotificationTranslationSeed;
  };
  publishedAt?: Date;
  sortOrder?: number;
  status?: 'active' | 'hidden';
}

export const DEFAULT_OFFICIAL_NOTIFICATIONS = [
  {
    id: 'agent-mode-launch-2026-05-26',
    title: 'Agent mode is live',
    body: 'Lumen Agent mode is now available. Start from a product link, selling points, or a reference video, and let Agent break down the script, shots, assets, and execution plan. This release focuses on the core shoppable-video flow first, with deeper multi-role collaboration coming next.',
    translations: {
      zh: {
        title: 'Agent 模式正式上线',
        body: 'Lumen Agent 模式已开放使用。你可以从商品链接、产品卖点或参考视频开始，让 Agent 自动拆解脚本、镜头、素材和执行计划。当前版本会优先覆盖带货短视频的核心链路，后续会继续补齐更细的多角色协作能力。',
      },
    },
    publishedAt: new Date('2026-05-26T10:00:00.000+08:00'),
    sortOrder: 0,
  },
  {
    id: 'hot-video-remix-launch-2026-05-26',
    title: 'Viral Remix is live',
    body: 'Viral Remix is now available as its own workspace. Browse official high-converting video structures, break references into hooks, selling points, shot rhythm, and rewrite directions, then bring them back into your own product project as an executable version.',
    translations: {
      zh: {
        title: '爆款复刻功能上线',
        body: '爆款复刻现在可以作为独立入口使用。你可以浏览官方整理的高转化视频结构，也可以把参考内容拆成钩子、卖点、镜头节奏和改写方向，再带回自己的商品项目里生成可执行版本。',
      },
    },
    publishedAt: new Date('2026-05-26T09:30:00.000+08:00'),
    sortOrder: 1,
  },
  {
    id: 'materials-library-launch-2026-05-26',
    title: 'Asset library is live',
    body: 'The asset library is now connected from the home page. The first phase centralizes product images, reference videos, brand elements, and reusable shot assets. Tag search, vector recall, and canvas-node references will follow so Agent can proactively pick assets while generating scripts.',
    translations: {
      zh: {
        title: '素材库上线',
        body: '素材库已接入首页入口。第一阶段会用于集中管理商品图、参考视频、品牌元素和可复用镜头素材；后续会继续加入标签检索、向量召回和画布节点引用，让 Agent 在生成脚本时能主动挑选素材。',
      },
    },
    publishedAt: new Date('2026-05-26T09:00:00.000+08:00'),
    sortOrder: 2,
  },
] as const satisfies readonly OfficialNotificationSeed[];

export interface OfficialNotificationRecordPort {
  isRead: boolean;
}

export interface NotificationRepositoryPort<TNotification extends OfficialNotificationRecordPort> {
  listOfficialForUser(
    actorUserId: string,
    limit: number,
    locale: NotificationLocale,
  ): Promise<TNotification[]>;
  markOfficialRead(actorUserId: string, notificationId: string): Promise<boolean>;
}

export interface NotificationSeedRepositoryPort {
  ensureDefaultOfficialNotifications(
    notifications: readonly OfficialNotificationSeed[],
  ): Promise<void>;
}

export interface OfficialNotificationsResult<TNotification extends OfficialNotificationRecordPort> {
  notifications: TNotification[];
  unreadCount: number;
}

export interface NotificationService<TNotification extends OfficialNotificationRecordPort> {
  listOfficial(
    actorUserId: string,
    locale?: NotificationLocale,
  ): Promise<OfficialNotificationsResult<TNotification>>;
  markOfficialRead(actorUserId: string, notificationId: string): Promise<boolean>;
}

export interface CreateNotificationServiceOptions<
  TNotification extends OfficialNotificationRecordPort,
> {
  getRepository: () =>
    | NotificationRepositoryPort<TNotification>
    | Promise<NotificationRepositoryPort<TNotification>>;
  trace?: TraceStep;
  tracePrefix: string;
}

const OFFICIAL_NOTIFICATION_LIMIT = 20;

export function createNotificationService<TNotification extends OfficialNotificationRecordPort>(
  options: CreateNotificationServiceOptions<TNotification>,
): NotificationService<TNotification> {
  const trace: TraceStep = options.trace ?? (async (_name, _operation, callback) => callback());

  return {
    async listOfficial(actorUserId, locale = 'en') {
      assertActorUserId(actorUserId);
      const repository = await trace(
        `${options.tracePrefix}.notifications.repository`,
        'db.connect',
        options.getRepository,
      );
      const notifications = await trace(
        `${options.tracePrefix}.notifications.list.db`,
        'db.query',
        () => repository.listOfficialForUser(actorUserId, OFFICIAL_NOTIFICATION_LIMIT, locale),
      );
      return {
        notifications,
        unreadCount: notifications.filter((notification) => !notification.isRead).length,
      };
    },

    async markOfficialRead(actorUserId, notificationId) {
      assertActorUserId(actorUserId);
      const repository = await trace(
        `${options.tracePrefix}.notifications.repository`,
        'db.connect',
        options.getRepository,
      );
      return trace(`${options.tracePrefix}.notifications.mark_read.db`, 'db.write', () =>
        repository.markOfficialRead(actorUserId, notificationId),
      );
    },
  };
}

export function seedDefaultOfficialNotifications(
  repository: NotificationSeedRepositoryPort,
): Promise<void> {
  return repository.ensureDefaultOfficialNotifications(DEFAULT_OFFICIAL_NOTIFICATIONS);
}

function assertActorUserId(actorUserId: string): void {
  if (!actorUserId.trim()) {
    throw new Error('actorUserId is required');
  }
}
