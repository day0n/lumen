import { redirectWithLocale } from '@/i18n/server';

export default async function AgentChatPage() {
  await redirectWithLocale('/app/canvas/new?agent=chat');
}
