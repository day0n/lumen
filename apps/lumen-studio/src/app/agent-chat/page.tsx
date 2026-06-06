import { redirect } from 'next/navigation';

export default function AgentChatPage() {
  redirect('/app/canvas/new?agent=chat');
}
