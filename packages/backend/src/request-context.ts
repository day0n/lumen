export type Locale = 'en' | 'zh';

export interface RequestActor {
  userId: string;
  clerkUserId: string;
  sessionId?: string;
}

export interface RequestContext {
  actor: RequestActor | null;
  locale: Locale;
  requestId: string;
  authToken?: string;
}
