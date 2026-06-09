import { ShareLoginPanel } from '@/components/share/ShareLoginPanel';
import { cloneSharedProject, getSharedProjectPreview } from '@/server/projects';
import { auth } from '@clerk/nextjs/server';
import { redirectWithLocale } from '@/i18n/server';
import { notFound } from 'next/navigation';

interface ShareProjectPageProps {
  params: Promise<{
    shareId: string;
  }>;
}

export default async function ShareProjectPage({ params }: ShareProjectPageProps) {
  const { shareId } = await params;
  const preview = await getSharedProjectPreview(shareId);
  if (!preview) notFound();

  const { userId } = await auth();
  if (!userId) {
    return <ShareLoginPanel projectTitle={preview.title} shareId={shareId} />;
  }

  const project = await cloneSharedProject(shareId);
  if (!project) notFound();

  await redirectWithLocale(`/app/canvas/${project.id}`);
}
