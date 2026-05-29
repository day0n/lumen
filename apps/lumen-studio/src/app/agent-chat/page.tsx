import { redirect } from 'next/navigation';

export default function AgentChatPage() {
  redirect('/canvas/new?agent=chat');
}
